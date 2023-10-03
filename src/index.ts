import { config } from 'dotenv'
import { AttachmentBuilder, EmbedBuilder, WebhookClient } from 'discord.js'
import NodeCache from 'node-cache'

import { getBufferFromImage, getPlaylist, getPlaylistPaged, getUserDisplayName, initializeApiClient } from './api/api'
import connect from './connect'
import { CacheKey } from './types/cache'
import Playlist from './types/playlist'
import { SpotifyImage, SpotifyPlaylist, SpotifyPlaylistPage, SpotifyTrackListItem } from './types/spotify'

import cron from 'node-cron'

config()
connect(process.env.MONGO_CONNECTION)
initializeApiClient()

const playlistCache = new NodeCache()
const tasks: Array<cron.ScheduledTask> = []

Playlist.find({}, 'id snapshot_id').then(x => {
  x.forEach(y => {
    playlistCache.set(y.id, {
      snapshotId: y.snapshot_id,
      processing: false
    } as CacheKey)
  })
  initializeTasks()
})

async function initializeTasks() {
  try {
    playlistCache.keys().forEach(async playlistId => {
      const task = cron.schedule('*/10 * * * * *', async () => {
        const { snapshotId, processing } = playlistCache.get(playlistId) as CacheKey
        if (processing) return

        playlistCache.set(playlistId, {
          snapshotId,
          processing: true
        })

        let newSnapshotId: string = snapshotId
        try {
          newSnapshotId = await processPlaylist(playlistId, snapshotId)
        } catch (error) {
          handleError(error)
        } finally {
          playlistCache.set(playlistId, {
            snapshotId: newSnapshotId,
            processing: false
          })
        }
      })
      tasks.push(task)
    })
  } catch (e) {
    console.error('Hit global error handler, uh oh')
    handleError(e)
  }
}

async function processPlaylist(playlistId: string, snapshotId: string): Promise<string> {
  if (snapshotId) {
    const list: SpotifyPlaylist = await getPlaylist(playlistId)

    if (snapshotId !== list.snapshot_id) {
      const existingPlaylist = await Playlist.findOne({ id: playlistId })
      const offset: number = list.tracks.total < 100 ? 0 : list.tracks.total - 100
      const lastPage: SpotifyPlaylistPage = await getPlaylistPaged(playlistId, offset, 100)
      const diff: SpotifyTrackListItem[] = lastPage.items.filter(x => {
        const identifier: string = x.track.id || x.track.uri
        return !existingPlaylist.tracks.some(y => y === identifier)
      })

      await Playlist.updateOne({ _id: existingPlaylist._id }, { snapshot_id: list.snapshot_id, $push: { tracks: diff.map(x => x.track.id || x.track.uri) } })

      diff.forEach(async x => {
        if (existingPlaylist.alerts.discord) await sendDiscordAlert(existingPlaylist.alerts.discord.url, list, x)
      })

      return list.snapshot_id
    }
  } else {
    //initial load
    const existingPlaylist = await Playlist.findOne({ id: playlistId })
    const list: SpotifyPlaylist = await getPlaylist(playlistId)
    const pages: number = list.tracks.total % list.tracks.limit ? Math.floor((list.tracks.total / list.tracks.limit) + 1) : (list.tracks.total / list.tracks.limit)
    const limit: number = list.tracks.limit

    let tracks: string[] = []
    for (let i = 0; i < pages; i++) {
      const page: SpotifyPlaylistPage = await getPlaylistPaged(playlistId, i * limit, limit)

      page.items.forEach(x => {
        tracks.push(x.track.id ? x.track.id : x.track.uri)
      })
    }

    await Playlist.updateOne({ _id: existingPlaylist._id }, { snapshot_id: list.snapshot_id, tracks })

    return list.snapshot_id
  }

  return snapshotId
}

async function sendDiscordAlert(url: string, list: SpotifyPlaylist, trackListItem: SpotifyTrackListItem) {
  const webhookClient = new WebhookClient({
    url
  })

  const max: number = Math.max(...trackListItem.track.album.images.map(x => x.height))
  const largestImage: SpotifyImage = trackListItem.track.album.images.filter(x => x.height === max)[0]
  const buffer: Buffer = await getBufferFromImage(largestImage.url)
  const attachment: AttachmentBuilder = new AttachmentBuilder(buffer).setName('img.jpeg')

  const embed: EmbedBuilder = new EmbedBuilder()
    .setColor('#1DB954')
    .setTitle(trackListItem.track.name)
    .setURL(trackListItem.track.external_urls.spotify)
    .setDescription(trackListItem.track.artists.map(x => x.name).join(', '))
    .setAuthor({
      name: `Track Added to ${list.name}`,
      url: list.external_urls.spotify
    })
    .addFields(
      { name: 'Added By', value: (await getUserDisplayName(trackListItem.added_by.id)).display_name, inline: true },
      { name: 'Added On', value: `<t:${+new Date(trackListItem.added_at) / 1000}:f>`, inline: true }
    )
    .setThumbnail('attachment://img.jpeg')

  await webhookClient.send({
    embeds: [embed],
    files: [attachment]
  })
}

function handleError(error) {
  if (error.response) {
    console.log('--- Response Data ---')
    console.log(error.response.data)
    console.log('--- Response Headers ---')
    console.log(error.response.headers)
    console.log('--- Response Status ---')
    console.log(error.response.status)
  } else if (error.request) {
    console.log('--- Request ---')
    console.log(error.request)
  } else {
    console.log('Error', error)
  }

  if (error.config) {
    console.log('--- Error Config ---')
    console.log(error.config)
  }
}