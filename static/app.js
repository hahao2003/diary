

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

