package app.medtap.wear

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.random.Random

/** A 30-second reaction test: tap when the screen turns green, 8 times. Early taps restart that try (and count). The
 *  median, slow taps (over 500 ms) and early taps go to the phone as a check-in. */
class ReactionActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var view: TextView
    private val times = ArrayList<Long>()
    private var early = 0
    private var goAt = 0L
    private var state = "wait"
    private val trials = 8

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        view = TextView(this).apply { gravity = Gravity.CENTER; textSize = 20f; setTextColor(Color.WHITE); setBackgroundColor(Color.DKGRAY) }
        view.setOnTouchListener { _, e -> if (e.action == MotionEvent.ACTION_DOWN) tap(); true }
        setContentView(view)
        arm()
    }

    private fun arm() {
        state = "wait"
        view.setBackgroundColor(Color.DKGRAY); view.text = "Wait for green…\n${times.size} of $trials"
        handler.postDelayed({ state = "go"; goAt = System.nanoTime(); view.setBackgroundColor(Color.rgb(21, 128, 61)); view.text = "Tap!" }, 1500L + Random.nextLong(2500L))
    }

    private fun tap() {
        when (state) {
            "wait" -> { handler.removeCallbacksAndMessages(null); early++; if (early > 5) finishWith(null) else arm() }
            "go" -> {
                val ms = (System.nanoTime() - goAt) / 1_000_000
                times.add(ms); state = "shown"
                view.setBackgroundColor(Color.DKGRAY); view.text = "$ms ms"
                if (times.size >= trials) handler.postDelayed({ finishWith(times) }, 600) else handler.postDelayed({ arm() }, 600)
            }
        }
    }

    private fun finishWith(t: List<Long>?) {
        if (t == null || t.size < 3) { view.text = "Too many early taps.\nTry again later."; handler.postDelayed({ finish() }, 2000); return }
        val s = t.filter { it in 101..1499 }.sorted()
        val median = if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
        val slow = s.count { it > 500 }
        view.text = "$median ms\n$slow slow · sending…"
        scope.launch {
            val ok = WatchState.checkIn(this@ReactionActivity, JSONObject().put("rtMs", median).put("rtLapses", slow).put("rtEarly", early))
            view.text = "$median ms\n${if (ok) "Saved on your phone ✓" else "Phone not connected"}"
            view.announceForAccessibility(view.text)
            handler.postDelayed({ finish() }, 2500)
        }
    }

    override fun onDestroy() { handler.removeCallbacksAndMessages(null); scope.cancel(); super.onDestroy() }
}
