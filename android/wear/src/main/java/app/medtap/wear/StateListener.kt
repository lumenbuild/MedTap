package app.medtap.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/** The phone changed what's next: keep it and refresh the tile. */
class StateListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED || e.dataItem.uri.path != WatchState.STATE_PATH) continue
            DataMapItem.fromDataItem(e.dataItem).dataMap.getString("json")?.let { WatchState.save(applicationContext, it) }
        }
    }
}
