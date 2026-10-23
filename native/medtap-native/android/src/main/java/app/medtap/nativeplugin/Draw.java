package app.medtap.nativeplugin;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/** Small pictures for widgets (they can't draw charts themselves): a time bar and a trend line. Colours follow the
 *  phone's light or dark mode. */
final class Draw {
    private Draw() {}

    private static Paint paint(int color) { Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); p.setColor(color); return p; }

    /** Dose → likely drop: green until the early edge, a light band to the late edge, a line at now. */
    static Bitmap timeBar(Context ctx, long from, long early, long late, long now) {
        int w = 600, h = 44;
        float r = 10;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        float top = 12, bottom = 32;
        double span = Math.max(1, late - from);
        float xe = (float) ((early - from) / span * w), xn = (float) Math.min(w - 2, Math.max(2, (now - from) / span * w));
        c.drawRoundRect(new RectF(0, top, w, bottom), r, r, paint(ctx.getColor(R.color.mw_track)));
        c.drawRoundRect(new RectF(xe, top, w, bottom), r, r, paint(ctx.getColor(R.color.mw_watch) & 0x55FFFFFF));
        c.drawRoundRect(new RectF(0, top, Math.max(r * 2, xe), bottom), r, r, paint(ctx.getColor(R.color.mw_good)));
        Paint now_ = paint(ctx.getColor(R.color.mw_text));
        c.drawRect(xn - 2, 2, xn + 2, h - 2, now_);
        return b;
    }

    /** Weekly points as a solid line with dots, then the forecast dashed. One y-scale for both. */
    static Bitmap trend(Context ctx, double[] pts, double[] fc) {
        int w = 600, h = 220, pad = 14;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        int n = pts.length + fc.length;
        if (pts.length < 2) return b;
        double lo = Double.MAX_VALUE, hi = -Double.MAX_VALUE;
        for (double v : pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        for (double v : fc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (hi - lo < 1) { double m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
        final double LO = lo, HI = hi;
        java.util.function.IntFunction<Float> x = (i) -> pad + (w - 2f * pad) * i / Math.max(1, n - 1);
        java.util.function.DoubleFunction<Float> y = (v) -> (float) (pad + (h - 2 * pad) * (1 - (v - LO) / (HI - LO)));
        Paint grid = paint(ctx.getColor(R.color.mw_track)); grid.setStrokeWidth(2);
        for (int k = 0; k <= 2; k++) { float gy = pad + (h - 2f * pad) * k / 2; c.drawLine(pad, gy, w - pad, gy, grid); }
        Paint line = paint(ctx.getColor(R.color.mw_text)); line.setStyle(Paint.Style.STROKE); line.setStrokeWidth(5); line.setStrokeCap(Paint.Cap.ROUND); line.setStrokeJoin(Paint.Join.ROUND);
        Path p = new Path();
        for (int i = 0; i < pts.length; i++) { if (i == 0) p.moveTo(x.apply(i), y.apply(pts[i])); else p.lineTo(x.apply(i), y.apply(pts[i])); }
        c.drawPath(p, line);
        if (fc.length > 0) {
            Paint dash = paint(ctx.getColor(R.color.mw_muted)); dash.setStyle(Paint.Style.STROKE); dash.setStrokeWidth(5); dash.setPathEffect(new DashPathEffect(new float[] { 14, 10 }, 0));
            Path f = new Path();
            f.moveTo(x.apply(pts.length - 1), y.apply(pts[pts.length - 1]));
            for (int i = 0; i < fc.length; i++) f.lineTo(x.apply(pts.length + i), y.apply(fc[i]));
            c.drawPath(f, dash);
        }
        Paint dot = paint(ctx.getColor(R.color.mw_text)), ring = paint(ctx.getColor(R.color.mw_bg));
        float lx = x.apply(pts.length - 1), ly = y.apply(pts[pts.length - 1]);
        c.drawCircle(lx, ly, 11, ring); c.drawCircle(lx, ly, 7, dot);
        return b;
    }
}
