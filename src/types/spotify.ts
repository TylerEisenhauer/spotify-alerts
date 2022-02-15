export interface SpotifyPlaylist {
    id: string
    snapshot_id: string
    name: string
    tracks: SpotifyPlaylistPage
    external_urls: {
        spotify: string
    }
}

export interface SpotifyPlaylistPage {
    items: SpotifyTrackListItem[]
    limit: number
    next: string
    offset: number
    previous: string
    total: number
}

export interface SpotifyTrackListItem {
    added_at: string
    added_by: {
        id: string
    }
    track: SpotifyTrack
}

export interface SpotifyTrack {
    id: string
    album: SpotifyAlbum
    artists: SpotifyArtist[]
    name: string,
    external_urls: {
        spotify: string
    }
    uri: string
}

export interface SpotifyAlbum {
    name: string
    images: SpotifyImage[]
    external_urls: {
        spotify: string
    }
}

export interface SpotifyImage {
    height: number
    url: string
    width: number
}

export interface SpotifyArtist {
    external_urls: {
        spotify: string
    }
    name: string
}

export interface SpotifyUser {
    display_name: string
}