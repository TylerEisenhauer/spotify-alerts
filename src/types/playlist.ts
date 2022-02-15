import mongoose, {Schema, Document} from 'mongoose'

export interface IPlaylist extends Document{
    id: string
    snapshot_id: string
    tracks: string[]
}

const PlaylistSchema: Schema = new Schema({
    id: {type: String, required: true},
    snapshot_id: {type: String, required: true},
    tracks: {type: [String], required: true}
})

export default mongoose.model<IPlaylist>('Playlist', PlaylistSchema)