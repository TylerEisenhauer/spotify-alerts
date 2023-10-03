import axios, { AxiosInstance } from 'axios'
import NodeCache from 'node-cache'
import { SpotifyPlaylist, SpotifyPlaylistPage, SpotifyUser } from '../types/spotify'

let client: AxiosInstance
const tokenCache: NodeCache = new NodeCache()

const displayNameCache = new NodeCache()

async function initializeApiClient(): Promise<void> {
  client = axios.create({
    baseURL: 'https://api.spotify.com/v1/',
  })
  await createRequestInterceptor()
  await createResponseInterceptor()
}

async function getAccessToken(): Promise<string> {
  if (!tokenCache.has('token')) {
    const { data } = await axios.post('https://accounts.spotify.com/api/token', null, {
      auth: {
        username: process.env.CLIENT_ID,
        password: process.env.CLIENT_SECRET
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      params: {
        grant_type: 'client_credentials'
      }
    })

    tokenCache.set('token', `${data.token_type} ${data.access_token}`, data.expires_in - 300) //expire the token 5 mins early to force a refresh
  }

  return `${tokenCache.get('token')}`
}

async function createRequestInterceptor(): Promise<void> {
  const interceptor: number = client.interceptors.request.use(async config => {
    const token = await getAccessToken()
    config.headers.Authorization = token
    return config
  }, error => Promise.reject(error))
}

async function createResponseInterceptor(): Promise<void> {
  const interceptor: number = client.interceptors.response.use(null, async (error) => {
    try {
      if (error.config && error.response && error.response.status === 429) {
        //handles rate limiting
        console.log('Hit Rate Limiting')
        const wait: number = (parseInt(error.response.headers['retry-after']) + 1) * 1000
        console.log(`Waiting ${error.response.headers['retry-after']} seconds, ${wait} milliseconds to retry`)
        await new Promise(r => setTimeout(r, wait))
        console.log(`Waiting done`)

        return client.request(error.config)
      }
    } catch {
      return Promise.reject(error)
    }
    throw error
  })
}

async function getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
  try {
    const { data } = await client.get(`playlists/${playlistId}`, {
      params: {
        fields: 'external_urls,name,snapshot_id,id,tracks(limit,next,offset,previous,total)'//,items(added_at,added_by(id),track(id,name,album(name,images),artists(external_urls,name),external_urls,uri)))'
      },
    })
    return data
  } catch (e) {
    console.log('Error getting playlist')
    throw e
  }
}

async function getPlaylistPaged(playlistId: string, offset: number = 0, limit: number = 100): Promise<SpotifyPlaylistPage> {
  try {
    const { data } = await client.get(`playlists/${playlistId}/tracks`, {
      params: {
        fields: 'limit,next,offset,previous,total,items(added_at,added_by(id),track(id,name,album(name,images,external_urls),artists(external_urls,name),external_urls,uri))',
        offset,
        limit
      }
    })
    return data
  } catch (e) {
    console.log('Error getting playlist')
    throw e
  }
}

async function getUserDisplayName(userId: string): Promise<SpotifyUser> {
  try {
    if (displayNameCache.has(userId)) {
      return displayNameCache.get(userId)
    }

    const { data } = await client.get(`users/${userId}`, {
      params: {
        fields: 'display_name'
      }
    })

    displayNameCache.set(userId, data, 60 * 10) //cache name for 10 mins

    return data
  } catch (e) {
    console.log('Error getting user display name')
    throw e
  }
}

async function getBufferFromImage(url: string) {
  try {
    const { data } = await axios.get(url, {
      responseType: 'arraybuffer'
    })
    const buffer = Buffer.from(data, 'utf-8')
    return buffer
  } catch (e) {
    console.log('Error getting buffer from image')
    throw e
  }
}

export {
  initializeApiClient,
  getPlaylist,
  getPlaylistPaged,
  getUserDisplayName,
  getBufferFromImage
}