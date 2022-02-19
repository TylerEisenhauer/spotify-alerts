import { config } from 'dotenv'
import { MessageAttachment, MessageEmbed, WebhookClient } from 'discord.js'
import NodeCache from 'node-cache'
import { KnownBlock, WebClient } from '@slack/web-api'

import api, { initializeApiClient } from './api/api'
import connect from './connect'
import Playlist from './types/playlist'
import { SpotifyImage, SpotifyPlaylist, SpotifyPlaylistPage, SpotifyTrackListItem } from './types/spotify'

config()
connect(process.env.MONGO_CONNECTION)
initializeApiClient()

const slackClient = new WebClient(process.env.SLACK_TOKEN)

const minutes = 1
const interval = minutes * 60 * 1000
const playlistCache = new NodeCache()

Playlist.find({}, 'id snapshot_id').then(x => {
    x.forEach(y => {
        playlistCache.set(y.id, y.snapshot_id)
    })
})

setInterval(async () => {
    try {
        playlistCache.keys().forEach(async x => {
            await processPlaylist(x)
        })
    } catch (e) {
        console.log(e.message)
    }
}, interval)

async function processPlaylist(playlistId: string) {
    if (playlistCache.has(playlistId)) {
        const list: SpotifyPlaylist = await api.getPlaylist(playlistId)

        if (playlistCache.get(playlistId) !== list.snapshot_id) {
            const existingPlaylist = await Playlist.findOne({ id: playlistId })
            const offset: number = list.tracks.total < 100 ? 0 : list.tracks.total - 100
            const lastPage: SpotifyPlaylistPage = await api.getPlaylistPaged(playlistId, offset, 100)

            const diff: SpotifyTrackListItem[] = lastPage.items.filter(x => {
                const identifier: string = x.track.id ? x.track.id : x.track.uri
                return !existingPlaylist.tracks.some(y => y === identifier)
            })

            await Playlist.updateOne({ _id: existingPlaylist._id }, { snapshot_id: list.snapshot_id, $push: { tracks: diff.map(x => x.track.id ? x.track.id : x.track.uri) } })

            diff.forEach(async x => {
                if (existingPlaylist.alerts.discord) await sendDiscordAlert(existingPlaylist.alerts.discord.url, list, x)
                if (existingPlaylist.alerts.slack) await sendSlackAlert(existingPlaylist.alerts.slack.channelId, list, x)
            })

            playlistCache.set(list.id, list.snapshot_id)
        }
    } else {
        //initial load
        const list: SpotifyPlaylist = await api.getPlaylist(playlistId)
        const pages: number = list.tracks.total % list.tracks.limit ? Math.floor((list.tracks.total / list.tracks.limit) + 1) : (list.tracks.total / list.tracks.limit)
        const limit: number = list.tracks.limit

        let tracks: string[] = []
        for (let i = 0; i < pages; i++) {
            const page: SpotifyPlaylistPage = await api.getPlaylistPaged(playlistId, i * limit, limit)
            page.items.forEach(x => {
                tracks.push(x.track.id ? x.track.id : x.track.uri)
            })
        }

        const playlist = {
            id: list.id,
            snapshot_id: list.snapshot_id,
            tracks
        }

        await Playlist.create(playlist)
        playlistCache.set(list.id, list.snapshot_id)
    }
}

async function sendDiscordAlert(url: string, list: SpotifyPlaylist, trackListItem: SpotifyTrackListItem) {
    try {
        const webhookClient = new WebhookClient({
            url
        })
    
        const max: number = Math.max(...trackListItem.track.album.images.map(x => x.height))
        const largestImage: SpotifyImage = trackListItem.track.album.images.filter(x => x.height === max)[0]
        const buffer: Buffer = await api.getBufferFromImage(largestImage.url)
        const attachment: MessageAttachment = new MessageAttachment(buffer, 'img.jpeg')
    
        const embed: MessageEmbed = new MessageEmbed()
            .setColor('#E5A00D')
            .setTitle(trackListItem.track.name)
            .setURL(trackListItem.track.external_urls.spotify)
            .setDescription(trackListItem.track.artists.map(x => x.name).join(', '))
            .setAuthor({
                name: `Track Added to ${list.name}`,
                url: list.external_urls.spotify
            })
            .addFields(
                { name: 'Added By', value: (await api.getUserDisplayName(trackListItem.added_by.id)).display_name, inline: true },
                { name: 'Added On', value: `<t:${+new Date(trackListItem.added_at) / 1000}:f>`, inline: true }
            )
            .setThumbnail('attachment://img.jpeg')
    
        await webhookClient.send({
            embeds: [embed],
            files: [attachment]
        })
    } catch (error) {
        console.log(error)
    }
}

async function sendSlackAlert(channelId: string, list: SpotifyPlaylist, trackListItem: SpotifyTrackListItem) {
    try {
        const max: number = Math.max(...trackListItem.track.album.images.map(x => x.height))
        const largestImage: SpotifyImage = trackListItem.track.album.images.filter(x => x.height === max)[0]
    
        const blocks: KnownBlock[] = [
            {
                type: 'section',
                text: {
                    text: `*Track Added to ${list.name}*`,
                    type: 'mrkdwn'
                },
                fields: [
                    {
                        type: 'mrkdwn',
                        text: '*Title*'
                    },
                    {
                        type: 'mrkdwn',
                        text: '*Artists*'
                    },
                    {
                        type: 'mrkdwn',
                        text: trackListItem.track.name
                    },
                    {
                        type: 'mrkdwn',
                        text: trackListItem.track.artists.map(x => x.name).join(', ')
                    },
                    {
                        type: 'mrkdwn',
                        text: '*Added By*'
                    },
                    {
                        type: 'mrkdwn',
                        text: '*Added On*'
                    },
                    {
                        type: 'mrkdwn',
                        text: (await api.getUserDisplayName(trackListItem.added_by.id)).display_name
                    },
                    {
                        type: 'mrkdwn',
                        text: new Date(trackListItem.added_at).toLocaleString()
                    }
                ],
                accessory: {
                    type: 'image',
                    image_url: `${largestImage.url}`,
                    alt_text: 'album art'
                }
            }
        ]
    
        await slackClient.chat.postMessage({
            channel: channelId,
            text: 'Track Added',
            blocks
        })
    } catch (error) {
        console.log(error);
    }
}