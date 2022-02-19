import axios, { AxiosError, AxiosInstance } from 'axios'
import NodeCache from 'node-cache'
import { SpotifyPlaylist, SpotifyPlaylistPage, SpotifyUser } from '../types/spotify'

let client: AxiosInstance

const displayNameCache = new NodeCache()

export async function initializeApiClient(): Promise<void> {
    client = axios.create({
        baseURL: 'https://api.spotify.com/v1/',
        headers: {
            Authorization: await getAccessToken()
        }
    })

    await createResponseInterceptor()
}

async function getAccessToken(): Promise<string> {
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

    return `Bearer ${data.access_token}`
}

async function createResponseInterceptor(): Promise<void> {
    const interceptor: number = client.interceptors.response.use(null, async (error) => {
        try {
            client.interceptors.response.eject(interceptor) //recreated in finally block
            if (error.config && error.response && error.response.status === 401) {
                const token: string = await getAccessToken()
                Object.assign(client.defaults.headers, { Authorization: token })
                Object.assign(error.config.headers, { Authorization: token })
                return client.request(error.config)
            } else if (error.config && error.response && error.response.status === 429) {
                //handles rate limiting (probably will never hit)
                const wait: number = (parseInt(error.response.headers['Retry-After']) + 1) * 1000
                await new Promise(r => setTimeout(r, wait))
                return client.request(error.config)
            }
        } catch {
            return Promise.reject(error)
        } finally {
            await createResponseInterceptor()
        }
        throw error
    })
}

async function getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    try {
        const { data } = await client.get(`playlists/${playlistId}`, {
            params: {
                fields: 'external_urls,name,snapshot_id,id,tracks(limit,next,offset,previous,total,items(added_at,added_by(id),track(id,name,album(name,images),artists(external_urls,name),external_urls,uri)))'
            }
        })
        return data
    } catch (e) {
        console.log('Error getting playlist')
        throw e
    }
}

async function getPlaylistPaged(playlistId: string, offset: number = 100, limit: number = 100): Promise<SpotifyPlaylistPage> {
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
        console.log('Error getting user display name')
        throw e
    }
}

export default {
    getPlaylist,
    getPlaylistPaged,
    getUserDisplayName,
    getBufferFromImage
}