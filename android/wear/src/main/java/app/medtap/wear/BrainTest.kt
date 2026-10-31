package app.medtap.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.random.Random

/**
 * Brain tests. Reaction (30 s): tap when the screen turns green, 8 times; early taps restart that try (and count).
 * The full test adds a 2-back memory part: letters one at a time, tap Match when one is the same as two before.
 * The median reaction time, slow taps (over 500 ms), early taps and, for the full test, the share right on the memory
 * part go to the phone as a check-in.
 */
@Composable
fun BrainTestScreen(full: Boolean, back: () -> Unit) {
    var stage by remember { mutableStateOf("intro") }
    val times = remember { mutableStateListOf<Long>() }
    var early by remember { mutableIntStateOf(0) }
    var nback by remember { mutableStateOf<Int?>(null) }
    when (stage) {
        "intro" -> Intro(if (full) "Brain test" else "Reaction test",
            if (full) "Part 1: tap as soon as the screen turns green. Part 2: tap Match when a letter is the same as two before." else "Tap as soon as the screen turns green. 8 tries.") { stage = "reaction" }
        "reaction" -> Reaction(times, onEarly = { early++ }, tooMany = { early > 5 }) { stage = if (early > 5) "fail" else if (full) "nbackIntro" else "result" }
        "nbackIntro" -> Intro("Part 2: memory", "Letters show one at a time. Tap Match when it's the same letter as two before.") { stage = "nback" }
        "nback" -> NBack { pct -> nback = pct; stage = "result" }
        "fail" -> Result("Too many early taps", "Try again later.", null, back)
        "result" -> {
            val s = times.filter { it in 101..1499 }.sorted()
            if (s.size < 3) Result("Not enough taps", "Try again later.", null, back)
            else {
                val median = if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
                val slow = s.count { it > 500 }
                val o = JSONObject().put("rtMs", median).put("rtLapses", slow).put("rtEarly", early)
                nback?.let { o.put("nbackPct", it) }
                Result("$median ms", listOfNotNull("$slow slow · $early early", nback?.let { "Memory $it% right" }).joinToString("\n"), o, back)
            }
        }
    }
}

@Composable
private fun Intro(title: String, body: String, start: () -> Unit) = Page {
    item { Label(title, C.mind) }
    item { Small(body, C.text) }
    item { Action("Start", C.mind, filled = true, onClick = start) }
}

@Composable
private fun Reaction(times: MutableList<Long>, onEarly: () -> Unit, tooMany: () -> Boolean, done: () -> Unit) {
    var state by remember { mutableStateOf("wait") }
    var goAt by remember { mutableLongStateOf(0L) }
    var shown by remember { mutableStateOf("") }
    var round by remember { mutableIntStateOf(0) }
    LaunchedEffect(round) {
        state = "wait"; shown = "Wait for green…\n${times.size} of 8"
        delay(1500L + Random.nextLong(2500L))
        state = "go"; goAt = System.nanoTime(); shown = "Tap!"
    }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().background(if (state == "go") C.good else C.surface).pointerInput(Unit) {
        detectTapGestures(onPress = {
            when (state) {
                "wait" -> { onEarly(); if (tooMany()) done() else { shown = "Too soon"; round++ } }
                "go" -> {
                    val ms = (System.nanoTime() - goAt) / 1_000_000
                    times.add(ms); state = "shown"; shown = "$ms ms"
                    scope.launch { delay(600); if (times.size >= 8) done() else round++ }
                }
            }
        })
    }.semantics { contentDescription = "Reaction test. Tap when the screen turns green." }, contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) { Big(shown, 22, if (state == "go") C.bg else C.text) }
    }
}

/** 2-back: 20 letters, about a third of them matches; right = a match tapped or a non-match left. */
@Composable
private fun NBack(done: (Int) -> Unit) {
    val letters = remember {
        val pool = "BCDFGHKLMNPRST"
        val seq = ArrayList<Char>()
        for (i in 0 until 20) seq.add(if (i >= 2 && Random.nextFloat() < 0.33f) seq[i - 2] else pool[Random.nextInt(pool.length)])
        seq
    }
    val ctx = LocalContext.current
    var k by remember { mutableIntStateOf(-1) }
    var showing by remember { mutableStateOf(false) }
    val tapped = remember { BooleanArray(20) }
    LaunchedEffect(Unit) {
        for (i in letters.indices) { k = i; showing = true; delay(1500); showing = false; delay(500) }
        var right = 0
        for (i in 2 until letters.size) if ((letters[i] == letters[i - 2]) == tapped[i]) right++
        done(Math.round(right * 100f / (letters.size - 2)))
    }
    Page {
        item { Small(if (k >= 0) "${k + 1} of 20" else "") }
        item { Big(if (showing && k >= 0) letters[k].toString() else " ", 48) }
        item {
            Action("Match", C.mind, filled = true) { if (k >= 2) { tapped[k] = true; Alarms.buzz(ctx, longArrayOf(0, 25)) } }
        }
    }
}

@Composable
private fun Result(title: String, body: String, send: JSONObject?, back: () -> Unit) {
    val ctx = LocalContext.current
    var status by remember { mutableStateOf(if (send != null) "Sending…" else "") }
    LaunchedEffect(Unit) {
        if (send != null) {
            val r = WatchState.checkIn(ctx, send)
            status = if (r == WatchState.Sent.SENT) "Saved on your phone ✓" else "Saved ✓ · sends when your phone's near"
        }
    }
    Page {
        item { Label("Result", C.mind) }
        item { Big(title, 26) }
        item { Small(body, C.text) }
        if (status.isNotEmpty()) item { Small(status, C.good) }
        item { Action("Done", C.mind, onClick = back) }
    }
}
