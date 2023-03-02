import mongoose, {Schema, Document} from 'mongoose'

export interface IPlaylist extends Document{
    id: string
    snapshot_id?: string
    tracks?: string[]
    alerts: AlertEndpoints
}

export interface AlertEndpoints {
    discord: {
        url: string
    }
}

const PlaylistSchema: Schema = new Schema({
    id: {type: String, required: true},
    snapshot_id: {type: String, required: false},
    tracks: {type: [String], required: false},
    alerts: {type: Object, required: true}
})

export default mongoose.model<IPlaylist>('Playlist', PlaylistSchema)