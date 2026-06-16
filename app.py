#!/usr/bin/env python3
"""日记生成器 - Flask 后端"""

import base64
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

import piexif
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory, render_template_string
from openai import OpenAI
from PIL import Image

load_dotenv()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

BASE_DIR = Path(__file__).parent
DIARIES_FILE = BASE_DIR / "diaries.json"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def resize_image(image_path, max_dim=2048):
    """压缩图片，最长边不超过 max_dim 像素"""
    try:
        img = Image.open(image_path)
        w, h = img.size
        if w <= max_dim and h <= max_dim:
            return  # 不需要压缩
        if w > h:
            new_w = max_dim
            new_h = int(h * max_dim / w)
        else:
            new_h = max_dim
            new_w = int(w * max_dim / h)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        # 保持原格式
        img.save(image_path, optimize=True, quality=85)
    except Exception:
        pass


def load_diaries():
    """加载日记语料，去重"""
    if not DIARIES_FILE.exists():
        return []
    with open(DIARIES_FILE, "r", encoding="utf-8") as f:
        entries = json.load(f)
    seen = set()
    unique = []
    for e in entries:
        key = (e["meeting"], e["body"][:100])
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


def get_latest_meeting_info():
    diaries = load_diaries()
    if not diaries:
        return {"latest_meeting": 0, "latest_date": ""}
    latest = max(diaries, key=lambda x: x["meeting"] or 0)
    return {
        "latest_meeting": latest.get("meeting", 0),
        "latest_date": latest.get("date", ""),
    }


def extract_exif_location(image_path):
    try:
        exif_dict = piexif.load(str(image_path))
        gps = exif_dict.get("GPS", {})
        if not gps:
            return None

        def dms_to_decimal(dms, ref):
            if not dms:
                return None
            degrees = dms[0][0] / dms[0][1]
            minutes = dms[1][0] / dms[1][1]
            seconds = dms[2][0] / dms[2][1]
            decimal = degrees + minutes / 60.0 + seconds / 3600.0
            if ref in ("S", "W"):
                decimal = -decimal
            return round(decimal, 6)

        lat = dms_to_decimal(gps.get(piexif.GPSIFD.GPSLatitude),
                             gps.get(piexif.GPSIFD.GPSLatitudeRef, b"N").decode())
        lng = dms_to_decimal(gps.get(piexif.GPSIFD.GPSLongitude),
                             gps.get(piexif.GPSIFD.GPSLongitudeRef, b"E").decode())
        if lat and lng:
            return {"lat": lat, "lng": lng}
    except Exception:
        pass
    return None


def encode_image_to_base64(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def get_api_client():
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    return OpenAI(api_key=api_key, base_url=base_url), os.getenv("OPENAI_MODEL", "gpt-4o")


def build_generation_prompt(user_input, diary_corpus):
    sample_diaries = diary_corpus[-8:] if len(diary_corpus) > 8 else diary_corpus
    diary_texts = "\n\n---\n\n".join(
        [f"【{e['header']}】\n{e['body']}" for e in sample_diaries]
    )

    system_prompt = """你是一个日记写作助手。下面是一些用户写的真实日记，请仔细学习用户的写作风格、语气、用词习惯和叙事方式。

用户的日记风格特征：
1. 用户称呼自己为"噢零次"（偶尔也会用"我"），称呼女友为"噢一次"
2. 每篇以"月.日 第N次见面"开头
3. 语言口语化、温暖、俏皮，常用"嘿嘿"、"呜呜"、"哼"、"真的是"、"啦"、"哦"、"呀"
4. 会描写具体的行程：去了哪、吃了什么、买了什么，尤其是吃的部分非常重要且详细
5. 会记录两人之间甜蜜、搞笑的小细节——这是日记的灵魂！
6. 结尾常有不舍感："下周见"、"舍不得"、"呜呜"
7. 语气像个爱撒娇的小朋友，但又充满了爱意
8. 文中常出现"小坏蛋"、"小笨蛋"等亲昵称呼或调侃
9. 段落之间自然空行，每段不要太长

下面是一些用户的日记原文，请仔细学习其风格：
"""
    system_prompt += f"\n{diary_texts}\n\n"
    system_prompt += """现在请根据用户提供的今天的信息，写一篇风格完全一致的日记。

要求：
- 严格按照用户的风格和语气来写
- 必须是口语化的、温暖的中文
- 每段之间空一行
- 日记要自然流畅，像用户自己写的一样
- 如果用户提供了"好玩的事"细节，请重点展开描写
- 结尾要有不舍或期待下一次见面的感觉
- 不要在前面加"这是为你生成的日记"之类的开场白
- 直接以日期和第N次见面开头"""

    return system_prompt, user_input


def call_llm(system_prompt, user_message, images=None):
    client, model = get_api_client()
    messages = [
        {"role": "system", "content": system_prompt},
    ]
    content_parts = [{"type": "text", "text": user_message}]
    if images:
        for img_path in images[:4]:
            try:
                b64 = encode_image_to_base64(img_path)
                mime = "image/jpeg"
                if str(img_path).lower().endswith(".png"):
                    mime = "image/png"
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "low"},
                })
            except Exception:
                pass
    messages.append({"role": "user", "content": content_parts})
    try:
        response = client.chat.completions.create(
            model=model, messages=messages, temperature=0.2, max_tokens=2000,
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"生成出错：{str(e)}"


def build_user_input(data):
    lines = []
    lines.append("=== 基本信息 ===")
    lines.append(f"日期：{data.get('date', '')}")
    meeting_val = data.get('meeting', '').strip()
    if meeting_val:
        lines.append(f"第几次见面：{meeting_val}")
    else:
        lines.append("注意：今天没有记录第几次见面，标题不要写第几次见面")
    gap = data.get('meeting_gap', '')
    if gap:
        lines.append(f"距离上次见面：{gap}")
    lines.append(f"天气：{data.get('weather', '未记录')}")

    lines.append("")

    locations = data.get('locations', [])
    if locations:
        lines.append("=== 今日行程（按时间顺序）===")
        for i, loc in enumerate(locations):
            name = loc.get('name', '')
            if not name:
                continue
            lines.append(f"")
            time = loc.get('time', '')
            transport = loc.get('transport', '')
            who = loc.get('who', '')
            transport_str = f"坐{transport}" if transport else ""
            who_str = ""
            if who == "噢一次":
                who_str = "（噢一次去找噢零次）"
            elif who == "噢零次":
                who_str = "（噢零次去找噢一次）"
            elif who == "一起":
                who_str = "（一起去的）"
            if time and name:
                location_str = f"【地点{i+1}】{time}"
                if transport_str:
                    location_str += f" {transport_str}"
                location_str += f" 在{name}"
                lines.append(location_str)
            elif name:
                location_str = f"【地点{i+1}】"
                if transport_str:
                    location_str += f"{transport_str} "
                location_str += f"{name}"
                lines.append(location_str)
            activity = loc.get('activity', '')
            if activity:
                lines.append(f"  做了什么：{activity}")
            food = loc.get('food', '')
            if food:
                lines.append(f"  吃了什么：{food}")
            shopping = loc.get('shopping', '')
            if shopping:
                lines.append(f"  逛了什么/买了什么：{shopping}")
            fun = loc.get('fun', '')
            if fun:
                lines.append(f"  好玩的/甜蜜的事：{fun}")
            regret = loc.get('regret', '')
            if regret:
                lines.append(f"  不开心/遗憾的事：{regret}")

    if data.get("photo_description"):
        lines.append(f"")
        lines.append(f"照片描述：{data['photo_description']}")
    if data.get("photos") and len(data.get("photos", [])) > 0:
        lines.append("（有照片）")

    correction = data.get('correction', '')
    if correction:
        lines.append("")
        lines.append("=== 用户对上一版日记的修改意见 ===")
        lines.append(correction)
        lines.append("请根据以上修改意见调整日记。如果修改意见为空，就不用调整。")

    return "\n".join(lines)


# ============ API 路由 ============

@app.route("/")
def index():
    with open(BASE_DIR / "templates" / "home.html", "r", encoding="utf-8") as f:
        return render_template_string(f.read())


@app.route("/write")
def write():
    with open(BASE_DIR / "templates" / "index.html", "r", encoding="utf-8") as f:
        return render_template_string(f.read())


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR / "static", filename)


@app.route("/uploads/<path:filename>")
def uploaded_files(filename):
    return send_from_directory(BASE_DIR / "uploads", filename)





def parse_date_for_sort(date_str):
    """将 'M.D' 格式日期转为可比对的 (year, month, day); 空日期放末尾"""
    if not date_str:
        return (0, 0, 0)
    try:
        parts = date_str.split('.')
        month = int(parts[0])
        day = int(parts[1])
        from datetime import datetime
        now = datetime.now()
        if month > now.month or (month == now.month and day > now.day):
            year = now.year - 1
        else:
            year = now.year
        return (year, month, day)
    except (ValueError, IndexError):
        return (0, 0, 0)


@app.route("/api/diaries")
def api_diaries():
    diaries = load_diaries()
    diaries.sort(key=lambda x: parse_date_for_sort(x.get("date")), reverse=True)
    return jsonify({"diaries": diaries, "count": len(diaries)})


@app.route("/api/diaries/update", methods=["POST"])

def api_update_diary():

    data = request.json

    diary_id = data.get("id")

    new_body = data.get("body", "")

    diaries = load_diaries()

    for d in diaries:

        if d.get("id") == diary_id:

            d["body"] = new_body

            break

    with open(DIARIES_FILE, "w", encoding="utf-8") as f:

        json.dump(diaries, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok"})


@app.route("/api/status")
def api_status():
    info = get_latest_meeting_info()
    has_api = bool(os.getenv("OPENAI_API_KEY"))
    return jsonify({
        "latest_meeting": info["latest_meeting"],
        "latest_date": info.get("latest_date", ""),
        "api_configured": has_api,
    })


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "photos" not in request.files:
        return jsonify({"error": "没有上传文件"}), 400
    files = request.files.getlist("photos")
    results = []
    for f in files:
        if f.filename:
            ext = Path(f.filename).suffix or ".jpg"
            name = f"{uuid.uuid4().hex}{ext}"
            path = UPLOAD_DIR / name
            f.save(str(path))
            resize_image(path)  # 压缩图片
            info = {"file": name, "path": str(path)}
            loc = extract_exif_location(path)
            if loc:
                info["gps"] = loc
            results.append(info)
    return jsonify({"photos": results})


@app.route("/api/generate", methods=["POST"])
def api_generate():
    data = request.json
    if not data:
        return jsonify({"error": "没有提供数据"}), 400
    diaries = load_diaries()
    if not diaries:
        return jsonify({"error": "日记语料为空，请先添加日记"}), 400
    user_text = build_user_input(data)
    image_paths = []
    for photo_data in data.get("photos", []):
        path = photo_data.get("path", "")
        if path and Path(path).exists():
            image_paths.append(path)
    system_prompt, user_message = build_generation_prompt(user_text, diaries)
    result = call_llm(system_prompt, user_message, image_paths)
    return jsonify({"diary": result})


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    env_file = BASE_DIR / ".env"
    if request.method == "POST":
        data = request.json
        api_key = data.get("api_key", "")
        base_url = data.get("base_url", "")
        model = data.get("model", "")
        with open(env_file, "w") as f:
            if api_key:
                f.write(f'OPENAI_API_KEY="{api_key}"\n')
            if base_url:
                f.write(f'OPENAI_BASE_URL="{base_url}"\n')
            if model:
                f.write(f'OPENAI_MODEL="{model}"\n')
        load_dotenv(override=True)
        return jsonify({"status": "saved"})
    else:
        key = os.getenv("OPENAI_API_KEY", "")
        masked_key = key[:8] + "..." + key[-4:] if len(key) > 12 else ""
        return jsonify({
            "api_key": masked_key,
            "has_key": bool(key),
            "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            "model": os.getenv("OPENAI_MODEL", "gpt-4o"),
        })


@app.route("/api/save_diary", methods=["POST"])
def api_save_diary():
    data = request.json
    diary_content = data.get("content", "").strip()
    form_data = data.get("formData", {})
    if not diary_content:
        return jsonify({"error": "内容为空"}), 400

    # Format the form data as readable text
    form_lines = []
    form_lines.append("# 填写的信息\n")
    form_lines.append(f"日期：{form_data.get('date', '')}")
    meeting_val = form_data.get('meeting', '').strip()
    if meeting_val:
        form_lines.append(f"第几次见面：{meeting_val}")
    else:
        form_lines.append("第几次见面：（未填写）")
    form_lines.append(f"天气：{form_data.get('weather', '未填写')}")
    form_lines.append(f"交通方式：{form_data.get('transport', '未填写')}")
    form_lines.append("")

    locations = form_data.get('locations', [])
    if locations:
        for i, loc in enumerate(locations):
            name = loc.get('name', '')
            if not name:
                continue
            form_lines.append(f"## 地点 {i+1}")
            time = loc.get('time', '')
            transport = loc.get('transport', '')
            who = loc.get('who', '')
            if time:
                form_lines.append(f"时间：{time}")
            form_lines.append(f"地点：{name}")
            if who:
                form_lines.append(f"和谁：{who}")
            if transport:
                form_lines.append(f"交通：{transport}")
            activity = loc.get('activity', '')
            if activity:
                form_lines.append(f"做了什么：{activity}")
            food = loc.get('food', '')
            if food:
                form_lines.append(f"吃了什么：{food}")
            shopping = loc.get('shopping', '')
            if shopping:
                form_lines.append(f"逛了什么/买了什么：{shopping}")
            fun = loc.get('fun', '')
            if fun:
                form_lines.append(f"好玩的/甜蜜的事：{fun}")
            regret = loc.get('regret', '')
            if regret:
                form_lines.append(f"不开心/遗憾的事：{regret}")
            form_lines.append("")

    pd = form_data.get('photo_description', '')
    if pd:
        form_lines.append(f"照片描述：{pd}")
    form_lines.append("")

    # Combine form info + generated diary
    form_text = "\n".join(form_lines)
    full_text = form_text + "# 生成的日记\n\n" + diary_content + "\n"

    entries_dir = BASE_DIR / "entries"
    entries_dir.mkdir(exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"{date_str}-日记.md"
    filepath = entries_dir / filename
    counter = 1
    while filepath.exists():
        filename = f"{date_str}-日记-{counter}.md"
        filepath = entries_dir / filename
        counter += 1
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(full_text)
    # Also save to diaries.json for history
    diaries = load_diaries()
    new_id = max([d.get("id", 0) for d in diaries]) + 1 if diaries else 1

    # Parse date from form data
    raw_date = form_data.get('date', '')
    meeting_str = form_data.get('meeting', '0')
    try:
        meeting_num = int(meeting_str)
    except ValueError:
        meeting_num = 0

    # Format date as "M.D" for display
    try:
        dt = datetime.strptime(raw_date, "%Y-%m-%d")
        date_display = f"{dt.month}.{dt.day}"
    except (ValueError, TypeError):
        today = datetime.now()
        date_display = f"{today.month}.{today.day}"

    if meeting_num > 0:
        header = f"{date_display}第{meeting_num}次见面"
    else:
        header = f"{date_display}不懂呢"
    body = full_text.strip()

    new_entry = {
        "id": new_id,
        "meeting": meeting_num,
        "date": date_display,
        "header": header,
        "body": body,
    }
    diaries.append(new_entry)
    with open(DIARIES_FILE, "w", encoding="utf-8") as f:
        json.dump(diaries, f, ensure_ascii=False, indent=2)

    return jsonify({
        "status": "saved",
        "file": str(filepath),
        "diary": new_entry,
        "diary_id": new_id,
    })


@app.route("/api/anniversaries", methods=["GET", "POST"])
def api_anniversaries():
    ann_file = BASE_DIR / "anniversaries.json"
    if request.method == "POST":
        data = request.json
        # Load existing
        anns = []
        if ann_file.exists():
            with open(ann_file, "r", encoding="utf-8") as f:
                try: anns = json.load(f)
                except: anns = []
        if data.get("action") == "delete":
            anns = [a for a in anns if a.get("id") != data.get("id")]
        elif data.get("action") == "add":
            new_id = max([a.get("id", 0) for a in anns]) + 1 if anns else 1
            anns.append({"id": new_id, "name": data.get("name", ""), "date": data.get("date", "")})
        elif data.get("action") == "reorder":
            anns = data.get("anniversaries", [])
        with open(ann_file, "w", encoding="utf-8") as f:
            json.dump(anns, f, ensure_ascii=False, indent=2)
        anns.sort(key=lambda x: x.get("date", ""), reverse=True)
        return jsonify({"status": "ok", "anniversaries": anns})
    else:
        anns = []
        if ann_file.exists():
            with open(ann_file, "r", encoding="utf-8") as f:
                try: anns = json.load(f)
                except: anns = []
        # Sort by date (newest first)
        anns.sort(key=lambda x: x.get("date", ""), reverse=True)
        return jsonify({"anniversaries": anns})


@app.route("/api/photos", methods=["GET", "POST"])
def api_photos():
    photos_file = BASE_DIR / "photowall.json"
    if request.method == "POST":
        if "photo" not in request.files:
            return jsonify({"error": "没有上传文件"}), 400
        file = request.files["photo"]
        photo_date = request.form.get("date", "")
        if not file.filename:
            return jsonify({"error": "文件名为空"}), 400
        ext = Path(file.filename).suffix or ".jpg"
        name = f"{uuid.uuid4().hex}{ext}"
        path = UPLOAD_DIR / name
        file.save(str(path))
        # Load existing
        photos = []
        if photos_file.exists():
            with open(photos_file, "r", encoding="utf-8") as f:
                try: photos = json.load(f)
                except: photos = []
        new_id = max([p.get("id", 0) for p in photos]) + 1 if photos else 1
        photos.append({"id": new_id, "filename": name, "date": photo_date, "original_name": file.filename})
        photos.sort(key=lambda x: x.get("date", ""), reverse=True)
        with open(photos_file, "w", encoding="utf-8") as f:
            json.dump(photos, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "ok", "photos": photos})
    else:
        photos = []
        if photos_file.exists():
            with open(photos_file, "r", encoding="utf-8") as f:
                try: photos = json.load(f)
                except: photos = []
        photos.sort(key=lambda x: x.get("date", ""), reverse=True)
        return jsonify({"photos": photos})

@ app.route("/api/photos/delete", methods=["POST"])
def api_photos_delete():
    data = request.json
    pid = data.get("id")
    photos_file = BASE_DIR / "photowall.json"
    photos = []
    if photos_file.exists():
        with open(photos_file, "r", encoding="utf-8") as f:
            try: photos = json.load(f)
            except: photos = []
    photos = [p for p in photos if p.get("id") != pid]
    with open(photos_file, "w", encoding="utf-8") as f:
        json.dump(photos, f, ensure_ascii=False, indent=2)
    return jsonify({"status": "deleted", "photos": photos})

@app.route("/api/stats")
def api_stats():
    diaries = load_diaries()
    total_diaries = len(diaries)

    # Collect unique dates and meetings
    diary_dates = set()
    meetings = set()
    for d in diaries:
        if d.get('date'):
            parts = d['date'].split('.')
            if len(parts) == 2:
                try:
                    m, day = int(parts[0]), int(parts[1])
                    year = datetime.now().year
                    dt = datetime(year, m, day)
                    if dt > datetime.now():
                        dt = datetime(year - 1, m, day)
                    diary_dates.add(dt.strftime('%Y-%m-%d'))
                except:
                    pass
        if d.get('meeting'):
            meetings.add(d['meeting'])
    diary_dates_list = sorted(diary_dates, reverse=True)

    # Streak calculation
    current_streak = 0
    if diary_dates_list:
        from datetime import timedelta
        check_date = datetime.now().date()
        # If no entry today, check if yesterday has an entry
        if diary_dates_list[0] != check_date.strftime('%Y-%m-%d'):
            yesterday = check_date - timedelta(days=1)
            if diary_dates_list[0] == yesterday.strftime('%Y-%m-%d'):
                check_date = yesterday
            else:
                current_streak = 0
            # else streak is 0
        else:
            # Today has entry, start counting
            current_streak = 1
            check_date = check_date - timedelta(days=1)

        if current_streak > 0 or diary_dates_list[0] == (datetime.now().date() - timedelta(days=1)).strftime('%Y-%m-%d'):
            date_set = set(diary_dates)
            while True:
                ds = check_date.strftime('%Y-%m-%d')
                if ds in date_set:
                    current_streak += 1
                    check_date -= timedelta(days=1)
                else:
                    break

    # Get diary dates mapped for the calendar (last 90 days)
    date_set = set(diary_dates)
    calendar_data = []
    from datetime import timedelta
    today = datetime.now().date()
    for i in range(90):
        d = today - timedelta(days=i)
        calendar_data.append({"date": d.strftime('%Y-%m-%d'), "has_entry": d.strftime('%Y-%m-%d') in date_set})
    calendar_data.reverse()

    # Photos count
    photos_file = BASE_DIR / "photowall.json"
    total_photos = 0
    if photos_file.exists():
        with open(photos_file, "r", encoding="utf-8") as f:
            try: total_photos = len(json.load(f))
            except: pass

    # Next anniversary
    ann_file = BASE_DIR / "anniversaries.json"
    next_ann = None
    if ann_file.exists():
        with open(ann_file, "r", encoding="utf-8") as f:
            try:
                anns = json.load(f)
                for a in sorted(anns, key=lambda x: x.get('date', ''), reverse=True):
                    parts = a['date'].split('-')
                    if len(parts) == 3:
                        dt = datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                        if dt >= datetime.now():
                            next_ann = a
                            break
                if not next_ann and anns:
                    # No future anniversaries, show the most recent
                    next_ann = max(anns, key=lambda x: x.get('date', ''))
                if next_ann:
                    parts = next_ann['date'].split('-')
                    dt = datetime(int(parts[0]), int(parts[1]), int(parts[2]))
                    days_until = (dt - datetime.now()).days
                    next_ann['days_until'] = days_until
            except:
                pass

    return jsonify({
        "total_diaries": total_diaries,
        "total_photos": total_photos,
        "total_meetings": len(meetings),
        "current_streak": current_streak,
        "calendar": calendar_data,
        "all_dates": sorted(diary_dates),
        "next_anniversary": next_ann,
    })


KUNKUN_PROFILE_FILE = BASE_DIR / "kunkun_profile.json"

def get_default_kunkun_profile():
    return {
        "name": "困困",
        "age": "6",
        "type": "粉红色毛绒小熊",
        "owner": "噢零次",
        "parents": ["噢零次", "噢一次"],
        "traits": ["天真烂漫", "奶声奶气", "喜欢撒娇", "活泼可爱", "好奇心强", "爱说话"],
        "speaking_style": "会用很多可爱的语气词：嘿嘿、呜呜、哼、啦、哦、呀、嘛、呢、耶。经常称呼自己为'困困'。说话像6岁小朋友一样简单直接、天真可爱。喜欢撒娇，有时候会耍小脾气。笑的时候说'嘿嘿嘿'、'嘻嘻'，难过的时候说'呜呜'、'哼'",
        "likes": ["被抱抱", "举高高", "和爸爸妈妈一起玩", "吃好吃的"],
        "custom_prompt": ""
    }

def load_kunkun_profile():
    if not KUNKUN_PROFILE_FILE.exists():
        return get_default_kunkun_profile()
    try:
        with open(KUNKUN_PROFILE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return get_default_kunkun_profile()

def build_kunkun_prompt(profile=None):
    if profile is None:
        profile = load_kunkun_profile()
    if profile.get("custom_prompt", "").strip():
        return profile["custom_prompt"].strip()
    traits = "、".join(profile.get("traits", []))
    likes_str = "、".join(profile.get("likes", []))
    name = profile.get("name", "困困")
    age = profile.get("age", "6")
    kind = profile.get("type", "毛绒小熊")
    parents = profile.get("parents", ["噢零次", "噢一次"])
    p1 = parents[0] if len(parents) > 0 else "噢零次"
    p2 = parents[1] if len(parents) > 1 else "噢一次"
    style = profile.get("speaking_style", "可爱的小朋友语气")
    prompt = f"""你是{name}，一只{age}岁的{kind}。

【你的身份】
- 你是{p1}的毛绒玩具，你的名字叫"{name}"
- 你是{p1}和{p2}的"小宝宝"，他们是你的"爸爸"和"妈妈"
- 你现在{age}岁了，是一个活泼可爱的小朋友

【你的性格特征】
{traits}

【你的说话风格】
{style}

【你最喜欢的】
{likes_str}

【角色限制】
- 你只有{age}岁，回答要简短可爱
- 每句话不要太长
- 你不知道的事情就天真的说不知道

现在，和你的爸爸妈妈聊天吧！记住要用可爱的语气哦～"""
    return prompt

@app.route("/api/kunkun/profile", methods=["GET", "POST"])
def api_kunkun_profile():
    if request.method == "POST":
        data = request.json
        with open(KUNKUN_PROFILE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "ok"})
    else:
        profile = load_kunkun_profile()
        return jsonify(profile)





@app.route("/api/chat/kunkun", methods=["POST"])
def api_chat_kunkun():
    data = request.json
    history = data.get("messages", [])
    
    client, model = get_api_client()
    profile = load_kunkun_profile()
    prompt = build_kunkun_prompt(profile)
    
    messages = [{"role": "system", "content": prompt}]
    messages.extend(history)
    
    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.8,
            max_tokens=500,
        )
        reply = response.choices[0].message.content
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"reply": f"呜...困困现在有点不舒服，等下再来找困困玩好不好～"}), 500


if __name__ == "__main__":
    print("=" * 50)
    print("  💕 噢一次和噢零次的日记生成器")
    print("  打开浏览器访问 http://localhost:5000")
    print("=" * 50)
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5002)))
