import { config } from 'dotenv'
import { MessageAttachment, MessageEmbed, WebhookClient } from 'discord.js'
import NodeCache from 'node-cache'

import api, { initializeApiClient } from './api/api'
import connect from './connect'
import Playlist from './types/playlist'
import { SpotifyImage, SpotifyPlaylist, SpotifyPlaylistPage, SpotifyTrackListItem } from './types/spotify'

config()
connect(process.env.MONGO_CONNECTION)
initializeApiClient()

const minutes = 1
const interval = minutes * 60 * 1000
const playlistCache = new NodeCache()

const webhookClient = new WebhookClient({
    id: process.env.DISCORD_WEBHOOK_ID,
    token: process.env.DISCORD_WEBHOOK_TOKEN
})

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
                const max: number = Math.max(...x.track.album.images.map(x => x.height))
                const largestImage: SpotifyImage = x.track.album.images.filter(x => x.height === max)[0]
                const buffer: Buffer = await api.getBufferFromImage(largestImage.url)
                const attachment: MessageAttachment = new MessageAttachment(buffer, 'img.jpeg')

                const embed: MessageEmbed = new MessageEmbed()
                    .setColor('#E5A00D')
                    .setTitle(x.track.name)
                    .setURL(x.track.external_urls.spotify)
                    .setDescription(x.track.artists.map(x => x.name).join())
                    .setAuthor({
                        name: `Track Added to ${list.name}`,
                        url: list.external_urls.spotify
                    })
                    .addFields(
                        { name: 'Added By', value: (await api.getUserDisplayName(x.added_by.id)).display_name, inline: true },
                        { name: 'Added On', value: `<t:${+new Date(x.added_at) / 1000}:f>`, inline: true }
                    )
                    .setThumbnail('attachment://img.jpeg')

                await webhookClient.send({
                    embeds: [embed],
                    files: [attachment]
                })
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