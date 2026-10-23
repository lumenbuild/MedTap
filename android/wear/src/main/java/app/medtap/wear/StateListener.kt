package app.medtap.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/** The phone changed what's next, or the workout: keep it and refresh the tile, complication and app. */
class StateListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED) continue
            val json = DataMapItem.fromDataItem(e.dataItem).dataMap.getString("json") ?: continue
            when (e.dataItem.uri.path) {
                WatchState.STATE_PATH -> WatchState.save(applicationContext, json)
                WatchState.WORKOUT_PATH -> WatchState.saveWorkout(applicationContext, json)
            }
        }
    }
}
