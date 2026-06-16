// ===== State =====
var uploadedPhotos = [];
var isGenerating = false;
var lastFormData = null;
var historyData = [];
var currentEditId = null;
var historyFromTab = null;
var streakDateSet = {};
var streakMonth = 0;
var streakYear = 0;
var locationCount = 0;

// ===== Init =====
document.addEventListener('DOMContentLoaded', async function() {
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('meetingDate').value = today;
  await loadStatus();
  await loadSettings();
  document.getElementById('photoInput').addEventListener('change', handlePhotoUpload);
  document.getElementById('meetingDate').addEventListener('input', checkFormComplete);
  document.getElementById('meetingDate').addEventListener('change', updateMeetingGap);
  document.getElementById('lastMeetingDate').addEventListener('change', updateMeetingGap);
  // Add 3 default locations
  for (var i = 0; i < 3; i++) {
    addLocation();
  }
  checkFormComplete();
});

async function loadStatus() {
  try {
    var res = await fetch('/api/status');
    var data = await res.json();
    var nextMeeting = (data.latest_meeting || 0) + 1;
    var meetingInput = document.getElementById('meetingCount');
    meetingInput.placeholder = '不记得可以不填（上次是第' + (data.latest_meeting || 0) + '次）';
        document.getElementById('meetingBadge').textContent = '上次第' + (data.latest_meeting || 0) + '次';
    // Auto-fill last meeting date
    if (data.latest_date) {
      var parts = data.latest_date.split('.');
      if (parts.length === 2) {
        var month = parseInt(parts[0]);
        var day = parseInt(parts[1]);
        var year = new Date().getFullYear();
        var tryDate = new Date(year, month - 1, day);
        if (tryDate > new Date()) {
          tryDate.setFullYear(year - 1);
        }
        var mm = String(tryDate.getMonth() + 1).padStart(2, '0');
        var dd = String(tryDate.getDate()).padStart(2, '0');
        document.getElementById('lastMeetingDate').value = tryDate.getFullYear() + '-' + mm + '-' + dd;
        updateMeetingGap();
      }
    }
    if (!data.api_configured) {
      document.getElementById('settingsNotice').style.display = 'flex';
    } else {
      document.getElementById('generateBtn').disabled = false;
    }
  } catch (e) {
    console.error('Failed to load status:', e);
  }
}

async function loadSettings() {
  try {
    var res = await fetch('/api/settings');
    var data = await res.json();
    document.getElementById('apiKey').placeholder = data.has_key ? '已设置' : 'sk-...';
    document.getElementById('baseUrl').value = data.base_url || 'https://api.openai.com/v1';
    document.getElementById('modelName').value = data.model || 'gpt-4o';
  } catch (e) {}
}

// ===== Tab Switching =====
function switchTab(tab) {
  var sections = document.querySelectorAll('.main');
  for (var i = 0; i < sections.length; i++) {
    sections[i].style.display = 'none';
  }
  var navItems = document.querySelectorAll('.nav-item');
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].classList.remove('active');
  }
  var target = document.getElementById('tab-' + tab);
  if (target) target.style.display = 'block';
  var navItem = document.querySelector('.nav-item[data-tab="' + tab + '"]');
  if (navItem) navItem.classList.add('active');
  if (tab === 'history') loadHistory();
  if (tab === 'anniversaries') loadAnniversaries();
  if (tab === 'photowall') loadPhotoWall();
  if (tab === 'stats') loadStats();
  if (tab === 'kunkun') loadKunkunChat();
}

// ===== Option Selector =====
function selectOption(btn, field) {
  var grid = btn.parentElement;
  var buttons = grid.querySelectorAll('.option-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.remove('selected');
  }
  btn.classList.add('selected');
  document.getElementById(field).value = btn.dataset.value;
}

function selectTransport(btn) {
  var grid = btn.parentElement;
  var buttons = grid.querySelectorAll('.option-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.remove('selected');
  }
  btn.classList.add('selected');
  var hidden = grid.parentElement.querySelector('.loc-transport');
  if (hidden) hidden.value = btn.dataset.value;
}

function selectWho(btn) {
  var grid = btn.parentElement;
  var buttons = grid.querySelectorAll('.option-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.remove('selected');
  }
  btn.classList.add('selected');
  var hidden = grid.parentElement.querySelector('.loc-who');
  if (hidden) hidden.value = btn.dataset.value;
}

// ===== Location Management =====
function addLocation() {
  var template = document.getElementById('locationTemplate');
  var clone = template.content.cloneNode(true);
  var container = document.getElementById('locationContainer');
  container.appendChild(clone);
  locationCount++;

  // Update all location numbers
  var blocks = container.querySelectorAll('.location-block');
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].querySelector('.loc-idx').textContent = i + 1;
  }

  // Add input listeners for the new block
  var newBlock = container.lastElementChild;
  var inputs = newBlock.querySelectorAll('input, textarea');
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener('input', checkFormComplete);
  }
  checkFormComplete();
}

function removeLocation(btn) {
  var block = btn.closest('.location-block');
  block.remove();
  locationCount--;

  // Re-number remaining blocks
  var container = document.getElementById('locationContainer');
  var blocks = container.querySelectorAll('.location-block');
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].querySelector('.loc-idx').textContent = i + 1;
  }
  checkFormComplete();
}

function collectLocations() {
  var container = document.getElementById('locationContainer');
  var blocks = container.querySelectorAll('.location-block');
  var locations = [];
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var name = block.querySelector('.loc-name').value.trim();
    if (!name) continue;
    var transportInput = block.querySelector('.loc-transport');
    locations.push({
      time: block.querySelector('.loc-time').value,
      name: name,
      transport: transportInput ? transportInput.value : '',
      who: (block.querySelector('.loc-who') || {}).value || '',
      activity: block.querySelector('.loc-activity').value.trim(),
      food: block.querySelector('.loc-food').value.trim(),
      shopping: block.querySelector('.loc-shopping').value.trim(),
      fun: block.querySelector('.loc-fun').value.trim(),
      regret: block.querySelector('.loc-regret').value.trim()
    });
  }
  return locations;
}

// ===== Meeting Gap Calculation =====
function updateMeetingGap() {
  var lastDate = document.getElementById('lastMeetingDate').value;
  var today = document.getElementById('meetingDate').value;
  if (lastDate && today) {
    var d1 = new Date(lastDate);
    var d2 = new Date(today);
    var diffTime = Math.abs(d2 - d1);
    var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    var gapEl = document.getElementById('meetingGap');
    if (diffDays === 0) {
      gapEl.textContent = '就是今天见面';
    } else if (diffDays < 7) {
      gapEl.textContent = diffDays + '天没见了';
    } else if (diffDays < 30) {
      gapEl.textContent = Math.floor(diffDays / 7) + '周没见了';
    } else {
      gapEl.textContent = Math.floor(diffDays / 30) + '个月没见了';
    }
  }
}

// ===== Photo Handling =====
async function handlePhotoUpload(event) {
  var files = event.target.files;
  if (!files || !files.length) return;
  var photoDate = document.getElementById('meetingDate').value;

  var formData = new FormData();
  for (var i = 0; i < files.length; i++) {
    formData.append('photos', files[i]);
  }
  try {
    var res = await fetch('/api/upload', { method: 'POST', body: formData });
    var data = await res.json();
    for (var j = 0; j < data.photos.length; j++) {
      uploadedPhotos.push(data.photos[j]);
      addPhotoPreview(data.photos[j]);
    }
    document.getElementById('photoDescriptionGroup').style.display = 'block';

    // Also save to photo wall
    if (photoDate) {
      for (var k = 0; k < files.length; k++) {
        var pwData = new FormData();
        pwData.append('photo', files[k]);
        pwData.append('date', photoDate);
        try { await fetch('/api/photos', { method: 'POST', body: pwData }); } catch(e) {}
      }
    }
  } catch (e) {
    showToast('上传失败：' + e.message);
  }
  event.target.value = '';
}

function addPhotoPreview(photo) {
  var container = document.getElementById('photoPreviews');
  var item = document.createElement('div');
  item.className = 'preview-item';
  item.innerHTML = '<img src="/uploads/' + photo.file + '" alt="photo" onclick="viewPhoto(\'/uploads/' + photo.file + '\')" style="cursor:pointer"><button class="remove-btn" onclick="removePhoto(\'' + photo.file + '\')">&times;</button>';

  container.appendChild(item);
}

function removePhoto(file) {
  uploadedPhotos = uploadedPhotos.filter(function(p) { return p.file !== file; });
  var items = document.querySelectorAll('#photoPreviews .preview-item');
  for (var i = 0; i < items.length; i++) {
    if (items[i].querySelector('img').src.indexOf(file) !== -1) {
      items[i].remove();
    }
  }
  if (uploadedPhotos.length === 0) {
    document.getElementById('photoDescriptionGroup').style.display = 'none';
  }
}

// ===== Form Validation =====
function checkFormComplete() {
  var date = document.getElementById('meetingDate').value;
  document.getElementById('generateBtn').disabled = !date;
}

// ===== Generate Diary (Preview) =====
async function generateDiary(correction) {
  if (isGenerating) return;
  var btn = document.getElementById('generateBtn');
  isGenerating = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 生成中...';

  try {
    var payload = {
      date: document.getElementById('meetingDate').value,
      meeting: document.getElementById('meetingCount').value,
      last_meeting_date: document.getElementById('lastMeetingDate').value,
      meeting_gap: document.getElementById('meetingGap').textContent,
      weather: document.getElementById('weather').value,

      locations: collectLocations(),
      photo_description: document.getElementById('photoDescription').value.trim(),
      photos: uploadedPhotos,
      correction: correction || '',
    };

    var res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();

    if (data.error) {
      showToast('生成失败：' + data.error);
      return;
    }

    lastFormData = payload;
    var prevSection = document.getElementById('previewSection');
    var content = document.getElementById('previewContent');
    // Store raw diary (without keywords) for saving
    var diaryText = data.diary;
    // Display diary text (keywords included)
    content.textContent = diaryText;
    prevSection.style.display = 'block';
    prevSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('日记预览已生成！');
  } catch (e) {
    showToast('生成失败：' + e.message);
  } finally {
    isGenerating = false;
    btn.disabled = false;
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> 预览日记';
  }
}

function regenerateDiary() { generateDiary(); }

function regenerateWithCorrection() {
  var correction = document.getElementById('correctionInput').value.trim();
  if (correction) {
    generateDiary(correction);
  } else {
    showToast('请先在文本框里填写修改意见');
  }
}

function copyPreview() {
  var text = document.getElementById('previewContent').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function() { showToast('已复制到剪贴板'); });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板');
  }
}

// ===== Confirm Save =====
async function confirmSave() {
  var text = document.getElementById('previewContent').textContent;
  if (!text.trim()) { showToast('日记内容为空'); return; }
  try {
    var res = await fetch('/api/save_diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, formData: lastFormData }),
    });
    var data = await res.json();
    if (data.status === 'saved') {
      showToast('日记已保存！');
      loadHistory();  // 刷新历史记录
      var meetingInput = document.getElementById('meetingCount');
      if (meetingInput.value) {
        updateLatestMeeting(parseInt(meetingInput.value));
      }
    } else {
      showToast('保存失败：' + (data.error || '未知错误'));
    }
  } catch (e) {
    showToast('保存失败：' + e.message);
  }
}

function viewPhoto(src) {
  var overlay = document.createElement('div');
  overlay.className = 'photo-viewer';
  overlay.onclick = function() { overlay.remove(); };
  var img = document.createElement('img');
  img.src = src;
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

function updateLatestMeeting(meetingNum) {
  var nextMeeting = meetingNum + 1;
  var meetingInput = document.getElementById('meetingCount');
    meetingInput.placeholder = '不记得可以不填（上次是第' + (data.latest_meeting || 0) + '次）';
  document.getElementById('meetingBadge').textContent = '上次第' + meetingNum + '次';
}

// ===== History =====
async function loadHistory() {
  var container = document.getElementById('historyList');
  try {
    var res = await fetch('/api/diaries');
    var data = await res.json();
    if (!data.diaries || data.diaries.length === 0) {
      container.innerHTML = '<p class="empty-state">还没有日记记录</p>';
      return;
    }
    historyData = data.diaries;
    var html = '';
    for (var i = 0; i < data.diaries.length; i++) {
      var d = data.diaries[i];
      var preview = d.body.slice(0, 150);
      if (d.body.length > 150) preview += '...';
      html += '<div class="history-item" onclick="showHistoryDetail(' + d.id + ')"><h3>' + d.header + '</h3><div class="preview">' + preview + '</div></div>';
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="empty-state">加载失败</p>';
  }
}

// ===== History Detail =====
function formatHistoryBody(body) {
  var parts = body.split('# \u751f\u6210\u7684\u65e5\u8bb0');
  var formSection = parts[0] || '';
  var diarySection = (parts[1] || '').trim();
  
  var formLines = formSection.split('\n');
  var basicInfo = {};
  var locations = [];
  var currentLocation = null;
  
  for (var i = 0; i < formLines.length; i++) {
    var line = formLines[i].trim();
    if (!line) continue;
    if (line === '# \u586b\u5199\u7684\u4fe1\u606f') continue;
    
    if (line.match(/^## \u5730\u70b9 \d+/)) {
      if (currentLocation) locations.push(currentLocation);
      currentLocation = {};
      continue;
    }
    
    // basic info
    if (line.indexOf('\u65e5\u671f\uff1a') === 0) {
      basicInfo.date = line.slice(3);
    } else if (line.indexOf('\u7b2c\u51e0\u6b21\u89c1\u9762\uff1a') === 0) {
      basicInfo.meeting = line.slice(6);
    } else if (line.indexOf('\u5929\u6c14\uff1a') === 0) {
      basicInfo.weather = line.slice(3);
    } else if (line.indexOf('\u4ea4\u901a\u65b9\u5f0f\uff1a') === 0) {
      basicInfo.transport = line.slice(5);
    } else if (line.indexOf('\u7167\u7247\u63cf\u8ff0\uff1a') === 0) {
      basicInfo.photoDesc = line.slice(5);
    } else if (currentLocation) {
      if (line.indexOf('\u65f6\u95f4\uff1a') === 0) currentLocation.time = line.slice(3);
      else if (line.indexOf('\u5730\u70b9\uff1a') === 0) currentLocation.name = line.slice(3);
      else if (line.indexOf('\u548c\u8c01\uff1a') === 0) currentLocation.who = line.slice(3);
      else if (line.indexOf('\u4ea4\u901a\uff1a') === 0) currentLocation.transport = line.slice(3);
      else if (line.indexOf('\u505a\u4e86\u4ec0\u4e48\uff1a') === 0) currentLocation.activity = line.slice(5);
      else if (line.indexOf('\u5403\u4e86\u4ec0\u4e48\uff1a') === 0) currentLocation.food = line.slice(5);
      else if (line.indexOf('\u901b\u4e86\u4ec0\u4e48') === 0) currentLocation.shopping = line.slice(line.indexOf('\uff1a')+1);
      else if (line.indexOf('\u597d\u73a9\u7684') === 0) currentLocation.fun = line.slice(line.indexOf('\uff1a')+1);
      else if (line.indexOf('\u4e0d\u5f00\u5fc3') === 0) currentLocation.regret = line.slice(line.indexOf('\uff1a')+1);
    }
  }
  if (currentLocation) locations.push(currentLocation);
  
  var html = '';
  
  // Basic info
  var hasBasicInfo = basicInfo.date || basicInfo.meeting || basicInfo.weather || (basicInfo.transport && basicInfo.transport !== '\u672a\u586b\u5199');
  if (hasBasicInfo) {
    html += '<div class="hf-info">';
    html += '<div class="hf-info-title">\u270f\ufe0f \u586b\u5199\u7684\u4fe1\u606f</div>';
    html += '<div class="hf-info-grid">';
    if (basicInfo.date) html += '<div class="hf-info-item"><span class="hf-info-label">\u65e5\u671f</span><span class="hf-info-value">' + basicInfo.date + '</span></div>';
    if (basicInfo.meeting && basicInfo.meeting !== '\uff08\u672a\u586b\u5199\uff09') html += '<div class="hf-info-item"><span class="hf-info-label">\u89c1\u9762</span><span class="hf-info-value">\u7b2c' + basicInfo.meeting + '\u6b21</span></div>'; else if (basicInfo.meeting) html += '<div class="hf-info-item"><span class="hf-info-label">\u89c1\u9762</span><span class="hf-info-value">\u4e0d\u61c2\u5462</span></div>';
    if (basicInfo.weather) html += '<div class="hf-info-item"><span class="hf-info-label">\u5929\u6c14</span><span class="hf-info-value">' + basicInfo.weather + '</span></div>';
    if (basicInfo.transport && basicInfo.transport !== '\u672a\u586b\u5199') html += '<div class="hf-info-item"><span class="hf-info-label">\u4ea4\u901a</span><span class="hf-info-value">' + basicInfo.transport + '</span></div>';
    if (basicInfo.photoDesc) html += '<div class="hf-info-item hf-info-full"><span class="hf-info-label">\u7167\u7247</span><span class="hf-info-value">' + basicInfo.photoDesc + '</span></div>';
    html += '</div></div>';
  }
  
  // Locations
  for (var j = 0; j < locations.length; j++) {
    var loc = locations[j];
    if (!loc.name) continue;
    html += '<div class="hf-loc-card">';
    html += '<div class="hf-loc-title">\ud83d\udccd \u5730\u70b9 ' + (j + 1) + ' - ' + loc.name + '</div>';
    html += '<div class="hf-loc-grid">';
    if (loc.time) html += '<div class="hf-loc-item"><span class="hf-loc-label">\u65f6\u95f4</span><span>' + loc.time + '</span></div>';
    if (loc.who) {
      html += '<div class="hf-loc-item"><span class="hf-loc-label">\u4eba\u7269</span><span>' + loc.who + '</span></div>';
    }
    if (loc.activity) html += '<div class="hf-loc-item hf-loc-full"><span class="hf-loc-label">\u505a\u4e86\u4ec0\u4e48</span><span>' + loc.activity + '</span></div>';
    if (loc.food) html += '<div class="hf-loc-item hf-loc-full"><span class="hf-loc-label">\u5403\u4e86\u4ec0\u4e48</span><span>' + loc.food + '</span></div>';
    if (loc.shopping) html += '<div class="hf-loc-item hf-loc-full"><span class="hf-loc-label">\u4e70\u4e86\u4ec0\u4e48</span><span>' + loc.shopping + '</span></div>';
    if (loc.fun) html += '<div class="hf-loc-item hf-loc-full"><span class="hf-loc-label">\u597d\u73a9\u7684</span><span>' + loc.fun + '</span></div>';
    if (loc.regret) html += '<div class="hf-loc-item hf-loc-full"><span class="hf-loc-label">\u9057\u61be</span><span>' + loc.regret + '</span></div>';
    html += '</div></div>';
  }
  
  // Diary
  html += '<div class="hf-diary">';
  html += '<div class="hf-diary-title">\ud83d\udcdd \u751f\u6210\u7684\u65e5\u8bb0</div>';
  html += '<div class="hf-diary-body">' + diarySection.replace(/\n/g, '<br>') + '</div>';
  html += '</div>';
  
  return html;
}


function showHistoryDetail(id) {
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].id === id) {
      var d = historyData[i];
      currentEditId = id;
      var content = '<h2>' + d.header + '</h2><div class="history-detail-body">' + formatHistoryBody(d.body) + '</div>';
      content += '<div class="history-detail-actions"><button class="btn-secondary" onclick="editHistoryEntry()"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> 编辑</button></div>';
      document.getElementById('historyDetailContent').innerHTML = content;
      document.getElementById('historyList').style.display = 'none';
      document.getElementById('historyDetail').style.display = 'block';
      break;
    }
  }
}

function closeHistoryDetail() {
  document.getElementById('historyDetail').style.display = 'none';
  if (historyFromTab === 'stats') {
    historyFromTab = null;
    document.getElementById('historyList').style.display = 'none';
    switchTab('stats');
  } else {
    document.getElementById('historyList').style.display = '';
  }
}

function editHistoryEntry() {
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].id === currentEditId) {
      var d = historyData[i];
      var html = '<h2>' + d.header + '</h2>';
      html += '<textarea id="editBody" class="history-edit-textarea">' + d.body.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>';
      html += '<div class="history-detail-actions">';
      html += '<button class="btn-primary" onclick="saveHistoryEntry()"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 保存</button> ';
      html += '<button class="btn-secondary" onclick="cancelEdit()">取消</button>';
      html += '</div>';
      document.getElementById('historyDetailContent').innerHTML = html;
      break;
    }
  }
}

async function saveHistoryEntry() {
  var newBody = document.getElementById('editBody').value;
  if (!newBody.trim()) { showToast('内容不能为空'); return; }
  try {
    var res = await fetch('/api/diaries/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentEditId, body: newBody }),
    });
    var data = await res.json();
    if (data.status === 'ok') {
      for (var i = 0; i < historyData.length; i++) {
        if (historyData[i].id === currentEditId) {
          historyData[i].body = newBody;
          break;
        }
      }
      showToast('已保存');
      showHistoryDetail(currentEditId);
    } else {
      showToast('保存失败');
    }
  } catch (e) {
    showToast('保存失败：' + e.message);
  }
}

function cancelEdit() {
  showHistoryDetail(currentEditId);
}

// ===== Settings =====
async function saveSettings() {
  var apiKey = document.getElementById('apiKey').value.trim();
  var baseUrl = document.getElementById('baseUrl').value.trim();
  var model = document.getElementById('modelName').value.trim();
  if (!apiKey) { showToast('请输入 API Key'); return; }
  try {
    var res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, base_url: baseUrl, model: model }),
    });
    var result = await res.json();
    if (result.status === 'saved') {
      document.getElementById('apiKey').value = '';
      document.getElementById('apiKey').placeholder = '已保存';
      document.getElementById('settingsNotice').style.display = 'none';
      document.getElementById('generateBtn').disabled = false;
      showToast('设置已保存');
    }
  } catch (e) {
    showToast('保存失败：' + e.message);
  }
}

// ===== Toast =====
var toastTimer = null;
function showToast(message) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2500);
}

// ===== Map Functionality =====
var currentMapInput = null;
var mapInstance = null;
var mapMarker = null;
var selectedLat = null;
var selectedLng = null;

function openMap(btn) {
  var block = btn.closest('.location-block');
  currentMapInput = block.querySelector('.loc-name');
  document.getElementById('mapOverlay').style.display = 'flex';
  document.getElementById('confirmMapBtn').disabled = true;
  document.getElementById('mapSelectedName').textContent = '点击地图选择地点';

  // Initialize map on first use
  if (!mapInstance) {
    mapInstance = L.map('mapContainer').setView([23.1291, 113.2644], 12); // Guangzhou
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(mapInstance);

    mapInstance.on('click', function(e) {
      selectedLat = e.latlng.lat;
      selectedLng = e.latlng.lng;
      if (mapMarker) mapInstance.removeLayer(mapMarker);
      mapMarker = L.marker(e.latlng).addTo(mapInstance);
      document.getElementById('confirmMapBtn').disabled = true;
      document.getElementById('mapSelectedName').textContent = '正在查询位置...';

      // Reverse geocode
      var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + selectedLat + '&lon=' + selectedLng + '&zoom=18&accept-language=zh';
      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var name = data.display_name || '未知地点';
          // Clean up the name - take the most relevant part
          var parts = name.split(',');
          var shortName = parts.slice(0, Math.min(3, parts.length)).join(',');
          document.getElementById('mapSelectedName').textContent = shortName;
          document.getElementById('confirmMapBtn').disabled = false;
        })
        .catch(function() {
          document.getElementById('mapSelectedName').textContent = '无法获取位置名称，确认后将填入坐标';
          document.getElementById('confirmMapBtn').disabled = false;
        });
    });
  } else {
    mapInstance.invalidateSize();
  }
}

function closeMap(event) {
  if (event && event.target !== document.getElementById('mapOverlay')) return;
  document.getElementById('mapOverlay').style.display = 'none';
}

function confirmMapLocation() {
  if (!currentMapInput) return;
  var nameEl = document.getElementById('mapSelectedName');
  var name = nameEl.textContent;
  if (name === '点击地图选择地点' || name === '正在查询位置...') return;
  currentMapInput.value = name;
  currentMapInput.dispatchEvent(new Event('input'));
  document.getElementById('mapOverlay').style.display = 'none';
  if (mapMarker) {
    mapInstance.removeLayer(mapMarker);
    mapMarker = null;
  }
}

// ===== Anniversary Countdown =====
function updateAnniversaryCountdown(anns) {
  if (!anns || !anns.length) { document.getElementById('annCountdown').style.display = 'none'; return; }
  var today = new Date();
  today.setHours(0,0,0,0);
  var nextAnn = null;
  var minDiff = Infinity;
  for (var i = 0; i < anns.length; i++) {
    var parts = anns[i].date.split('-');
    if (parts.length === 3) {
      var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
      d.setHours(0,0,0,0);
      var diff = d.getTime() - today.getTime();
      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        nextAnn = anns[i];
      }
    }
  }
  if (!nextAnn) {
    // No future anniversaries, show most recent
    var latest = null;
    var latestDate = null;
    for (var j = 0; j < anns.length; j++) {
      var parts = anns[j].date.split('-');
      if (parts.length === 3) {
        var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
        if (!latestDate || d > latestDate) {
          latestDate = d;
          latest = anns[j];
        }
      }
    }
    if (latest) {
      var el = document.getElementById('annCountdown');
      el.style.display = 'flex';
      document.getElementById('annCountName').textContent = latest.name;
      document.getElementById('annCountDate').textContent = latest.date;
      var diffTime = today.getTime() - latestDate.getTime();
      var diffDays = Math.round(diffTime / (1000*60*60*24));
      document.getElementById('annCountDays').innerHTML = diffDays + '天前';
    }
    return;
  }
  var el = document.getElementById('annCountdown');
  el.style.display = 'flex';
  document.getElementById('annCountName').textContent = nextAnn.name;
  document.getElementById('annCountDate').textContent = nextAnn.date;
  var daysUntil = Math.round(minDiff / (1000*60*60*24));
  if (daysUntil === 0) {
    document.getElementById('annCountDays').innerHTML = '✨ 就是今天！';
  } else {
    document.getElementById('annCountDays').innerHTML = '还有 ' + daysUntil + ' 天';
  }
}

// ===== Anniversaries =====
function loadAnniversaries() {
  fetch('/api/anniversaries')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var list = document.getElementById('anniversaryList');
      var anns = data.anniversaries || [];
      if (!anns.length) {
        list.innerHTML = '<p class="empty-state">还没有纪念日，点击上方按钮添加</p>';
        return;
      }
      var html = '';
      // Sort by date (newest first)

      // Calculate next anniversary countdown
      updateAnniversaryCountdown(anns);

      for (var i = 0; i < anns.length; i++) {
        var a = anns[i];
        var countInfo = calculateAnniversaryDays(a.date);
        var emojis = ['\u2764\uFE0F', '\uD83D\uDC9B', '\uD83D\uDC9A', '\uD83D\uDC99', '\uD83D\uDC9C', '\uD83D\uDC9D'];
        var emoji = emojis[i % emojis.length];
        html += '<div class="anniversary-card">' +
          '<div class="anniversary-icon">' + emoji + '</div>' +
          '<div class="anniversary-info">' +
            '<div class="anniversary-name">' + escapeHtml(a.name) + '</div>' +
            '<div class="anniversary-date-text">' + a.date + '</div>' +
          '</div>' +
          '<div class="anniversary-count">' + countInfo.days +
            '<span class="anniversary-count-label">' + countInfo.label + '</span>' +
          '</div>' +
          '<button class="anniversary-delete" onclick="deleteAnniversary(' + a.id + ')" title="删除">\u00D7</button>' +
        '</div>';
      }
      list.innerHTML = html;
    })
    .catch(function(e) { console.error('Failed to load anniversaries:', e); });
}

function calculateAnniversaryDays(dateStr) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var parts = dateStr.split('-');
  var annDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  annDate.setHours(0, 0, 0, 0);
  var diffTime = annDate.getTime() - today.getTime();
  var diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return { days: '\u2728', label: '就是今天！' };
  } else if (diffDays > 0) {
    return { days: diffDays, label: '天后' };
  } else {
    return { days: Math.abs(diffDays), label: '天前' };
  }
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function showAnniversaryForm() {
  document.getElementById('annName').value = '';
  document.getElementById('annDate').value = '';
  document.getElementById('annFormOverlay').style.display = 'flex';
}

function closeAnniversaryForm() {
  document.getElementById('annFormOverlay').style.display = 'none';
}

function saveAnniversary() {
  var name = document.getElementById('annName').value.trim();
  var date = document.getElementById('annDate').value;
  if (!name) { showToast('请输入纪念的事'); return; }
  if (!date) { showToast('请选择日期'); return; }
  fetch('/api/anniversaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', name: name, date: date }),
  })
  .then(function(r) { return r.json(); })
  .then(function() {
    closeAnniversaryForm();
    loadAnniversaries();
    showToast('纪念日已添加！');
  })
  .catch(function(e) { showToast('添加失败：' + e.message); });
}

function deleteAnniversary(id) {
  if (!confirm('确定删除这个纪念日吗？')) return;
  fetch('/api/anniversaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id: id }),
  })
  .then(function(r) { return r.json(); })
  .then(function() {
    loadAnniversaries();
    showToast('纪念日已删除');
  })
  .catch(function(e) { showToast('删除失败：' + e.message); });
}

// ===== Drag and Drop for Anniversaries =====
var draggedAnnId = null;

function dragStart(event, id) {
  draggedAnnId = id;
  event.target.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
}

function dragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  var cards = document.querySelectorAll('.anniversary-card');
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.remove('drag-over');
  }
  var target = event.target.closest('.anniversary-card');
  if (target) target.classList.add('drag-over');
}

function annDrop(event) {
  event.preventDefault();
  if (!draggedAnnId) return;
  var target = event.target.closest('.anniversary-card');
  if (!target) return;
  var targetId = parseInt(target.getAttribute('data-id'));
  if (targetId === draggedAnnId) return;

  // Reorder
  var list = document.getElementById('anniversaryList');
  var cards = Array.from(list.querySelectorAll('.anniversary-card'));
  var dragIdx = cards.findIndex(function(c) { return parseInt(c.getAttribute('data-id')) === draggedAnnId; });
  var dropIdx = cards.findIndex(function(c) { return parseInt(c.getAttribute('data-id')) === targetId; });
  if (dragIdx === -1 || dropIdx === -1) return;

  // Build new order
  var items = [];
  for (var i = 0; i < cards.length; i++) {
    items.push(parseInt(cards[i].getAttribute('data-id')));
  }
  var item = items.splice(dragIdx, 1)[0];
  items.splice(dropIdx, 0, item);

  // Save new order
  saveAnniversaryOrder(items);
  annDragEnd();
}

function annDragEnd() {
  var cards = document.querySelectorAll('.anniversary-card');
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.remove('dragging', 'drag-over');
  }
  draggedAnnId = null;
}

function saveAnniversaryOrder(idOrder) {
  // Get current anniversaries and reorder
  var list = document.getElementById('anniversaryList');
  var cards = list.querySelectorAll('.anniversary-card');
  var dataMap = {};
  for (var i = 0; i < cards.length; i++) {
    var id = parseInt(cards[i].getAttribute('data-id'));
    var name = cards[i].querySelector('.anniversary-name').textContent;
    var dateText = cards[i].querySelector('.anniversary-date-text').textContent;
    dataMap[id] = { id: id, name: name, date: dateText };
  }
  var reordered = [];
  for (var j = 0; j < idOrder.length; j++) {
    if (dataMap[idOrder[j]]) {
      reordered.push(dataMap[idOrder[j]]);
    }
  }
  fetch('/api/anniversaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reorder', anniversaries: reordered }),
  })
  .then(function(r) { return r.json(); })
  .then(function() { loadAnniversaries(); })
  .catch(function(e) { console.error('Reorder failed:', e); });
}

// ===== Photo Wall =====
function loadPhotoWall() {
  fetch('/api/photos')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('photowallList');
      var photos = data.photos || [];
      if (!photos.length) {
        container.innerHTML = '<p class="empty-state">还没有照片，选好日期上传吧</p>';
        return;
      }
      // Group by date
      var groups = {};
      for (var i = 0; i < photos.length; i++) {
        var p = photos[i];
        var date = p.date || '未标注日期';
        if (!groups[date]) groups[date] = [];
        groups[date].push(p);
      }
      var dates = Object.keys(groups).sort().reverse();
      var html = '';
      for (var d = 0; d < dates.length; d++) {
        var dateStr = dates[d];
        var displayDate = dateStr;
        if (dateStr !== '未标注日期') {
          var parts = dateStr.split('-');
          if (parts.length === 3) displayDate = parts[0] + '年' + parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
        }
        html += '<div class="pw-date-header">' + displayDate + '</div>';
        html += '<div class="pw-grid">';
        var dayPhotos = groups[dateStr];
        for (var j = 0; j < dayPhotos.length; j++) {
          html += '<div class="pw-item">' +
            '<img src="/uploads/' + dayPhotos[j].filename + '" alt="photo" onclick="viewPhoto(\'/uploads/' + dayPhotos[j].filename + '\')" style="cursor:pointer">' +
            '<button class="pw-delete" onclick="deletePhotoWall(' + dayPhotos[j].id + ')" title="删除">&times;</button>' +
          '</div>';
        }
        html += '</div>';
      }
      container.innerHTML = html;
    })
    .catch(function(e) { console.error('Failed to load photowall:', e); });
}

function uploadPhotoWall(input) {
  var file = input.files[0];
  if (!file) return;
  var date = document.getElementById('pwDate').value;
  if (!date) { showToast('请先选择日期'); input.value = ''; return; }
  var formData = new FormData();
  formData.append('photo', file);
  formData.append('date', date);
  fetch('/api/photos', { method: 'POST', body: formData })
    .then(function(r) { return r.json(); })
    .then(function() {
      input.value = '';
      loadPhotoWall();
      showToast('照片已上传！');
    })
    .catch(function(e) { showToast('上传失败：' + e.message); input.value = ''; });
}

function deletePhotoWall(id) {
  if (!confirm('确定删除这张照片吗？')) return;
  fetch('/api/photos/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id }),
  })
  .then(function(r) { return r.json(); })
  .then(function() { loadPhotoWall(); showToast('照片已删除'); })
  .catch(function(e) { showToast('删除失败：' + e.message); });
}

// ===== Stats =====
function loadStats() {
  fetch('/api/stats')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('statDiaries').textContent = data.total_diaries || 0;
      document.getElementById('statPhotos').textContent = data.total_photos || 0;
      document.getElementById('statMeetings').textContent = data.total_meetings || 0;
      document.getElementById('statStreak').textContent = (data.current_streak || 0) + '天';

      // Anniversary countdown
      var ann = data.next_anniversary;
      if (ann) {
        var el = document.getElementById('annCountdown');
        el.style.display = 'flex';
        document.getElementById('annCountName').textContent = ann.name;
        document.getElementById('annCountDate').textContent = ann.date;
        var days = ann.days_until;
        if (days === undefined) { el.style.display = 'none'; }
        else if (days === 0) {
          document.getElementById('annCountDays').innerHTML = '\u2728 就是今天！';
        } else if (days < 0) {
          document.getElementById('annCountDays').innerHTML = Math.abs(days) + '天前';
        } else {
          document.getElementById('annCountDays').innerHTML = '还有 ' + days + ' 天';
        }
      }

      // Store streak dates
      streakDateSet = {};
      var allDates = data.all_dates || [];
      for (var si = 0; si < allDates.length; si++) {
        streakDateSet[allDates[si]] = true;
      }
      var now = new Date();
      streakMonth = now.getMonth();
      streakYear = now.getFullYear();
      renderStreakMonth();
    })
    .catch(function(e) { console.error('Failed to load stats:', e); });
}

function renderStreakMonth() {
  var container = document.getElementById('streakGrid');
  var html = '';
  html += '<div class="streak-nav">';
  html += '<button class="streak-nav-btn" onclick="streakNav(-1)">◀</button>';
  html += '<span class="streak-month-label">' + streakYear + '年' + (streakMonth + 1) + '月</span>';
  html += '<button class="streak-nav-btn" onclick="streakNav(1)">▶</button>';
  html += '</div>';
  var dayNames = ['一', '二', '三', '四', '五', '六', '日'];
  html += '<div class="streak-month-grid">';
  for (var d = 0; d < dayNames.length; d++) {
    html += '<div class="streak-day-header">' + dayNames[d] + '</div>';
  }
  var firstDay = new Date(streakYear, streakMonth, 1);
  var lastDay = new Date(streakYear, streakMonth + 1, 0);
  var startDow = firstDay.getDay();
  startDow = (startDow === 0) ? 6 : startDow - 1;
  for (var e = 0; e < startDow; e++) {
    html += '<div class="streak-cell empty"></div>';
  }
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  for (var day = 1; day <= lastDay.getDate(); day++) {
    var mm = String(streakMonth + 1).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    var dateStr = streakYear + '-' + mm + '-' + dd;
    var cellDate = new Date(streakYear, streakMonth, day);
    var isFuture = cellDate > today;
    var hasEntry = !isFuture && streakDateSet[dateStr];
    var isToday = cellDate.getTime() === today.getTime();
    var cls = 'streak-cell';
    if (isFuture) cls += ' future';
    else if (hasEntry) cls += ' filled';
    else cls += ' empty-day';
    if (isToday) cls += ' today';
    if (hasEntry) {
      html += '<div class="' + cls + '" title="' + dateStr + '" onclick="goToDateDiary(\'' + dateStr + '\')">' + day + '</div>';
    } else {
      html += '<div class="' + cls + '" title="' + dateStr + '">' + day + '</div>';
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

function streakNav(delta) {
  streakMonth += delta;
  if (streakMonth > 11) { streakMonth = 0; streakYear++; }
  else if (streakMonth < 0) { streakMonth = 11; streakYear--; }
  renderStreakMonth();
}

function goToDateDiary(dateStr) {
  var parts = dateStr.split('-');
  var diaryDate = parseInt(parts[1]) + '.' + parseInt(parts[2]);
  
  function findAndShow() {
    for (var i = 0; i < historyData.length; i++) {
      if (historyData[i].date === diaryDate) {
        historyFromTab = 'stats';
        switchTab('history');
        showHistoryDetail(historyData[i].id);
        return true;
      }
    }
    showToast('未找到该日期的日记');
    return false;
  }
  
  if (historyData.length > 0) {
    findAndShow();
  } else {
    fetch('/api/diaries')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        historyData = data.diaries || [];
        if (!findAndShow()) {
          showToast('未找到该日期的日记');
        }
      })
      .catch(function(e) { showToast('加载失败'); });
  }
}

// ===== 困困 Chat =====
var kunkunMessages = [];
var kunkunLoaded = false;

function loadKunkunChat() {
  if (kunkunLoaded) return;
  kunkunLoaded = true;
  
  var bear = String.fromCharCode(55357, 56379);
  var check = String.fromCharCode(65039);
  var welcome = "嘿嘿！困困终于等到你啦" + check + " 你是来找困困玩的吗？困困好开心呀！";
  kunkunMessages.push({ role: "assistant", content: welcome });
  renderKunkunMessages();
  
  var input = document.getElementById('kunkunInput');
  if (input) {
    input.onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendKunkunMessage();
      }
    };
  }
}

function renderKunkunMessages() {
  var container = document.getElementById('kunkunMessages');
  if (!container) return;
  var html = '';
  for (var i = 0; i < kunkunMessages.length; i++) {
    var msg = kunkunMessages[i];
    var isUser = msg.role === 'user';
    html += '<div class="km-msg ' + (isUser ? 'km-user' : 'km-kunkun') + '">';
    if (!isUser) {
      html += '<div class="km-avatar">' + String.fromCharCode(55357, 56379) + '</div>';
    }
    html += '<div class="km-bubble">' + msg.content.replace(/\n/g, '<br>') + '</div>';
    if (isUser) {
      html += '<div class="km-avatar km-avatar-user">' + String.fromCharCode(9786, 65039) + '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function sendKunkunMessage() {
  var input = document.getElementById('kunkunInput');
  var btn = document.getElementById('kunkunSendBtn');
  var text = (input.value || '').trim();
  if (!text) return;
  
  input.value = '';
  btn.disabled = true;
  btn.innerHTML = '...';
  
  kunkunMessages.push({ role: "user", content: text });
  renderKunkunMessages();
  
  var container = document.getElementById('kunkunMessages');
  container.innerHTML += '<div class="km-msg km-kunkun" id="typingIndicator"><div class="km-avatar">' + String.fromCharCode(55357, 56379) + '</div><div class="km-bubble km-typing"><span class="km-dot">.</span><span class="km-dot">.</span><span class="km-dot">.</span></div></div>';
  container.scrollTop = container.scrollHeight;
  
  var history = kunkunMessages.slice(-10);
  
  fetch('/api/chat/kunkun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
    
    var reply = data.reply || String.fromCharCode(55357, 56834) + ' 困困不知道该说什么啦～';
    kunkunMessages.push({ role: "assistant", content: reply });
    renderKunkunMessages();
  })
  .catch(function(e) {
    var typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
    
    kunkunMessages.push({ role: "assistant", content: "呜...困困现在有点累了，等下再来找困困玩好不好～" });
    renderKunkunMessages();
  })
  .finally(function() {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  });
}


// ===== 困困 性格设置 =====
var kunkunDefaultProfile = null;

function toggleKunkunSettings() {
  var settings = document.getElementById('kunkunSettings');
  var messages = document.getElementById('kunkunMessages');
  var inputArea = document.querySelector('.kunkun-input-area');
  var btn = document.getElementById('kunkunSettingsBtn');
  
  if (settings.style.display !== 'none') {
    // Switch to chat
    settings.style.display = 'none';
    messages.style.display = '';
    inputArea.style.display = '';
    btn.innerHTML = '\u2699\uFE0F';
    // Reload profile (in case it was changed elsewhere)
    kunkunMessages = [];
    kunkunLoaded = false;
    loadKunkunChat();
  } else {
    // Switch to settings
    settings.style.display = 'block';
    messages.style.display = 'none';
    inputArea.style.display = 'none';
    btn.innerHTML = '\uD83D\uDCAC';
    loadKunkunProfile();
  }
}

function loadKunkunProfile() {
  fetch('/api/kunkun/profile')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('ksName').value = data.name || '困困';
      document.getElementById('ksNickname').value = data.nickname || '困困、小困';
      document.getElementById('ksPetName').value = data.pet_name || '';
      document.getElementById('ksGender').value = data.gender || '';
      document.getElementById('ksAge').value = data.age || '6';
      document.getElementById('ksPersonality').value = data.personality_type || '';
      document.getElementById('ksIdentity').value = data.identity || '';
      document.getElementById('ksBackground').value = data.background || '';
      document.getElementById('ksRelationship').value = data.relationship || '';
      document.getElementById('ksStyle').value = data.speaking_style || '';
      kunkunDefaultProfile = data;
    })
    .catch(function(e) {
      console.error('Failed to load kunkun profile:', e);
    });
}

function saveKunkunProfile() {
  var profile = {
    name: document.getElementById('ksName').value.trim() || '困困',
    nickname: document.getElementById('ksNickname').value.trim() || '困困、小困',
    pet_name: document.getElementById('ksPetName').value.trim() || '',
    gender: document.getElementById('ksGender').value.trim() || '',
    age: document.getElementById('ksAge').value.trim() || '6',
    personality_type: document.getElementById('ksPersonality').value.trim() || '',
    identity: document.getElementById('ksIdentity').value.trim() || '',
    background: document.getElementById('ksBackground').value.trim() || '',
    relationship: document.getElementById('ksRelationship').value.trim() || '',
    speaking_style: document.getElementById('ksStyle').value.trim() || '',
    likes: []
  };
  
  var btn = document.querySelector('.ks-actions .btn-primary');
  btn.disabled = true;
  btn.textContent = '\u4FDD\u5B58\u4E2D...';
  
  fetch('/api/kunkun/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  .then(function(r) { return r.json(); })
  .then(function() {
    showToast('\u6027\u683C\u8BBE\u5B9A\u5DF2\u4FDD\u5B58\uFF01');
    var nameText = profile.name + ' \uD83D\uDDF8';
    var descText = (profile.personality_type || profile.identity || '\u53EF\u7231\u7684\u5C0F\u5BB6\u4F19') + ' \u2022 ' + profile.age + '\u5C81';
    document.getElementById('kunkunHeaderName').textContent = nameText;
    document.getElementById('kunkunHeaderDesc').textContent = descText;
    toggleKunkunSettings();
  })
  .catch(function(e) {
    showToast('\u4FDD\u5B58\u5931\u8D25\uFF1A' + e.message);
  })
  .finally(function() {
    btn.disabled = false;
    btn.textContent = '\uD83D\uDCBE \u4FDD\u5B58\u8BBE\u5B9A';
  });
}

function resetKunkunProfile() {
  if (!confirm('\u786E\u5B9A\u8981\u6062\u590D\u56F0\u56F0\u7684\u9ED8\u8BA4\u6027\u683C\u5417\uFF1F')) return;
  
  fetch('/api/kunkun/reset', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function() {
      loadKunkunProfile();
      showToast('\u5DF2\u6062\u590D\u9ED8\u8BA4\u6027\u683C');
    })
    .catch(function(e) {
      showToast('\u6062\u590D\u5931\u8D25\uFF1A' + e.message);
    });
}
