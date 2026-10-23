package app.medtap.wear

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/** The next dose with a "Log it" button, and a button for each as-needed medicine. */
class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val pad = (resources.displayMetrics.widthPixels * 0.12).toInt()
            setPadding(pad, pad / 2, pad, pad)
        }
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(list) })
        render(WatchState.load(this))
    }

    override fun onResume() {
        super.onResume()
        scope.launch { WatchState.refresh(this@MainActivity); render(WatchState.load(this@MainActivity)) }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    private fun text(s: String, size: Float, color: Int = Color.WHITE) = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); gravity = Gravity.CENTER
    }

    private fun button(label: String, medId: String) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { v ->
            v.isEnabled = false
            scope.launch {
                val ok = WatchState.log(this@MainActivity, medId)
                text = if (ok) "Logged ✓" else "Phone not connected"
                announceForAccessibility(text)
                if (!ok) v.isEnabled = true
            }
        }
    }

    private fun render(d: JSONObject) {
        list.removeAllViews()
        val title = d.optString("title", "")
        if (title.isEmpty()) {
            list.addView(text(d.optString("app", getString(R.string.app_name)), 14f, Color.LTGRAY))
            list.addView(text("Open the app on your phone to set up", 16f))
        } else {
            list.addView(text(d.optString("label", "Next"), 13f, Color.LTGRAY))
            list.addView(text(title, 18f))
            d.optString("when", "").takeIf { it.isNotEmpty() }?.let { list.addView(text(it, 14f)) }
            d.optString("detail", "").takeIf { it.isNotEmpty() }?.let { list.addView(text(it, 12f, Color.LTGRAY)) }
            d.optString("logId", "").takeIf { it.isNotEmpty() }?.let { list.addView(button("Log it", it)) }
        }
        val prn = d.optJSONArray("prn")
        if (prn != null) for (k in 0 until prn.length()) {
            val b = prn.optJSONObject(k) ?: continue
            list.addView(button("Log ${b.optString("name")}", b.optString("id")))
        }
        list.addView(View(this).apply { minimumHeight = 24 })
    }
}
