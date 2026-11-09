#!/usr/bin/env python3
"""
Генерация демо-видео для приложения:
1. Английская озвучка (серверный TTS) по сегментам
2. Замер реальных длительностей через ffprobe
3. Сборка фонового видео (ffmpeg gradients + drawtext)
4. Микшивание аудио с паузами, mux в mp4
5. SRT с точными таймкодами
Результат: public/demo/demo.mp4 + public/demo/demo.srt
"""
import json
import subprocess
import sys
from pathlib import Path

OUT = Path("/home/z/my-project/public/demo")
TMP = Path("/tmp/demo_build")
TMP.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

SEGMENTS = [
    "Hello, and welcome to the video translation demo.",
    "This short clip was generated specially for this application.",
    "The player you see right now is playing the original English speech.",
    "When you press translate, every phrase will be translated into Russian, by a large language model.",
    "The translation appears as subtitles, directly over the video.",
    "You can also read the full text in the transcript panel, and jump to any moment.",
    "And the experimental voice-over feature reads the translation aloud, in sync with the video.",
    "Now go ahead: translate this video, and see how it works!",
]

GAP = 0.45  # пауза между репликами, сек
SR = 24000


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print("CMD FAILED:", " ".join(cmd))
        print(r.stderr[-2000:])
        sys.exit(1)
    return r


def run_retry(cmd, attempts=5, wait=4, **kw):
    for a in range(1, attempts + 1):
        r = subprocess.run(cmd, capture_output=True, text=True, **kw)
        if r.returncode == 0:
            return r
        print(f"  попытка {a}/{attempts} не удалась, ждём {wait}с...")
        import time
        time.sleep(wait)
    print("CMD FAILED:", " ".join(cmd))
    print(r.stderr[-1500:])
    sys.exit(1)


def duration_of(path):
    r = run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)])
    return float(r.stdout.strip())


def main():
    # 1. TTS для каждого сегмента
    wav_paths = []
    for i, text in enumerate(SEGMENTS):
        wav = TMP / f"seg_{i:02d}.wav"
        if not wav.exists() or wav.stat().st_size < 1000:
            run_retry(["z-ai", "tts", "-i", text, "--voice", "xiaochen",
                       "-o", str(wav)])
        wav_paths.append(wav)
        print(f"TTS {i + 1}/{len(SEGMENTS)}: {wav.name} {wav.stat().st_size}b")

    # 2. Длительности и таймлайн
    durs = [duration_of(p) for p in wav_paths]
    starts = []
    t = 0.6
    for d in durs:
        starts.append(t)
        t += d + GAP
    total = t + 0.8
    print(f"Общая длительность: {total:.2f} сек")

    # 3. Фоновое видео (градиент + текст)
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    font_reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bg = TMP / "bg.mp4"
    run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-t", f"{total:.3f}",
        "-i", f"gradients=s=1280x720:c0=#0f172a:c1=#1d4d4d:c2=#0f172a:x0=0:y0=0:x1=1280:y1=720:nb_colors=3:speed=0.02:seed=42",
        "-vf",
        f"drawtext=fontfile={font}:text='VideoTranslate':fontsize=72:fontcolor=white:"
        f"x=(w-text_w)/2:y=250:shadowx=2:shadowy=2:shadowcolor=black@0.6,"
        f"drawtext=fontfile={font_reg}:text='Real-time video translation — demo':"
        f"fontsize=36:fontcolor=#a7f3d0:x=(w-text_w)/2:y=360:shadowx=1:shadowy=1:shadowcolor=black@0.6,"
        f"drawtext=fontfile={font_reg}:text='Translate me!':fontsize=30:fontcolor=white@0.55:"
        f"x=(w-text_w)/2:y=470",
        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
        str(bg),
    ])
    print("Фон готов")

    # 4. Микш аудио: silence-подложка + adelay для каждого сегмента
    inputs = ["-f", "lavfi", "-t", f"{total:.3f}", "-i", f"anullsrc=r={SR}:cl=mono"]
    for p in wav_paths:
        inputs += ["-i", str(p)]
    n = len(wav_paths)
    fc_parts = []
    mix_labels = "[0:a]"
    for i, s in enumerate(starts):
        ms = int(round(s * 1000))
        fc_parts.append(f"[{i + 1}:a]aformat=sample_rates={SR}:channel_layouts=mono,adelay={ms}|{ms}[a{i}]")
        mix_labels += f"[a{i}]"
    fc = ";".join(fc_parts) + ";" + mix_labels + f"amix=inputs={n + 1}:normalize=0:duration=first[out]"
    mixed = TMP / "mixed.wav"
    run(["ffmpeg", "-y", *inputs, "-filter_complex", fc, "-map", "[out]",
         "-ar", str(SR), str(mixed)])
    print("Аудио смикшировано")

    # 5. Mux
    run(["ffmpeg", "-y", "-i", str(bg), "-i", str(mixed),
         "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
         str(OUT / "demo.mp4")])
    print("Видео собрано:", (OUT / "demo.mp4").stat().st_size, "байт")

    # 6. SRT
    def ts(sec):
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = sec % 60
        return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

    srt_lines = []
    for i, text in enumerate(SEGMENTS):
        start = starts[i]
        end = start + durs[i]
        srt_lines.append(f"{i + 1}\n{ts(start)} --> {ts(end)}\n{text}\n")
    (OUT / "demo.srt").write_text("\n".join(srt_lines), encoding="utf-8")
    print("SRT записан:", (OUT / "demo.srt").stat().st_size, "байт")

    meta = {
        "title": "Демо: как работает перевод видео",
        "author": "VideoTranslate",
        "duration": round(total, 2),
        "segments": len(SEGMENTS),
    }
    (OUT / "demo.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
    print("Готово:", meta)


if __name__ == "__main__":
    main()
