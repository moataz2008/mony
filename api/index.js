// دفتر معاملات مالية خفيف جداً - بدون JavaScript في المتصفح
// التخزين: Upstash Redis (من متجر Vercel Marketplace) عبر REST

var URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
var TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
var PASS = process.env.APP_PASSWORD || '';
var KEY = 'tx';
var MAX_SHOW = 40;

function redis(cmd) {
  return fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.error) throw new Error(j.error);
    return j.result;
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toLatinDigits(s) {
  return String(s).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 0x0660; })
    .replace(/[\u06F0-\u06F9]/g, function (d) { return d.charCodeAt(0) - 0x06F0; })
    .replace(/\u066B|\u060C|,/g, '.');
}

function money(n) { return (Math.round(n * 100) / 100).toFixed(2); }

function authOk(req) {
  if (!PASS) return true;
  var h = req.headers.authorization || '';
  if (h.indexOf('Basic ') !== 0) return false;
  var decoded = Buffer.from(h.slice(6), 'base64').toString();
  return decoded.slice(decoded.indexOf(':') + 1) === PASS;
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  var out = {};
  var raw = typeof req.body === 'string' ? req.body : '';
  raw.split('&').forEach(function (p) {
    if (!p) return;
    var i = p.indexOf('=');
    var k = decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, ' '));
    var v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' '));
    out[k] = v;
  });
  return out;
}

function page(inner) {
  return '<!DOCTYPE html><html dir="rtl" lang="ar"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>دفتر المعاملات</title>' +
    '<style>' +
    'body{margin:0;padding:6px;font-family:Arial,Tahoma,sans-serif;font-size:16px;color:#000;background:#fff}' +
    'h1{font-size:20px;margin:4px 0}' +
    'form{margin:0}' +
    'label{display:block;margin:6px 0 2px}' +
    'input,select{width:94%;padding:6px;font-size:16px;border:1px solid #666}' +
    'input.b,button{width:100%;padding:10px;font-size:18px;margin-top:8px;border:1px solid #000;background:#ddd}' +
    '.box{border:1px solid #999;padding:6px;margin:8px 0}' +
    '.in{color:#060}.out{color:#a00}' +
    '.row{border-bottom:1px solid #ccc;padding:6px 0}' +
    '.sm{font-size:13px;color:#555}' +
    'button.d{width:auto;font-size:13px;padding:3px 8px;margin:4px 0 0}' +
    '</style></head><body>' + inner + '</body></html>';
}

module.exports = async function (req, res) {
  function send(code, body, headers) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (headers) for (var k in headers) res.setHeader(k, headers[k]);
    res.end(body);
  }

  if (!authOk(req)) {
    return send(401, page('<p>مطلوب كلمة المرور</p>'),
      { 'WWW-Authenticate': 'Basic realm="Ledger"' });
  }
  if (!URL_ || !TOKEN) {
    return send(500, page('<p>التخزين غير مربوط. اربط Upstash Redis في Vercel.</p>'));
  }

  try {
    if (req.method === 'POST') {
      var b = parseBody(req);
      if (b.action === 'del' && b.id) {
        await redis(['HDEL', KEY, String(b.id)]);
      } else if (b.action === 'add') {
        var amt = parseFloat(toLatinDigits(b.amount || ''));
        if (amt > 0 && isFinite(amt)) {
          var id = String(Date.now()) + String(Math.floor(Math.random() * 90 + 10));
          var rec = {
            id: id,
            t: b.type === 'out' ? 'out' : 'in',
            a: Math.round(amt * 100) / 100,
            n: String(b.note || '').slice(0, 100),
            d: new Date().toISOString().slice(0, 10)
          };
          await redis(['HSET', KEY, id, JSON.stringify(rec)]);
        }
      }
      return send(302, '', { Location: '/' });
    }

    var flat = (await redis(['HGETALL', KEY])) || [];
    var list = [];
    for (var i = 1; i < flat.length; i += 2) {
      try { list.push(JSON.parse(flat[i])); } catch (e) {}
    }
    list.sort(function (x, y) { return x.id < y.id ? 1 : -1; });

    var inc = 0, out = 0;
    list.forEach(function (r) { if (r.t === 'in') inc += r.a; else out += r.a; });

    var html = '<h1>دفتر المعاملات</h1>' +
      '<div class="box">' +
      '<div class="in">الدخل: ' + money(inc) + '</div>' +
      '<div class="out">المصروف: ' + money(out) + '</div>' +
      '<div><b>الرصيد: ' + money(inc - out) + '</b></div></div>' +
      '<form method="post" action="/" class="box">' +
      '<input type="hidden" name="action" value="add">' +
      '<label>النوع</label>' +
      '<select name="type"><option value="in">دخل</option><option value="out">مصروف</option></select>' +
      '<label>المبلغ</label><input name="amount" type="text" autocomplete="off">' +
      '<label>ملاحظة</label><input name="note" type="text" maxlength="100">' +
      '<button type="submit">حفظ</button></form>' +
      '<h1>آخر المعاملات (' + list.length + ')</h1>';

    list.slice(0, MAX_SHOW).forEach(function (r) {
      html += '<div class="row"><span class="' + r.t + '">' +
        (r.t === 'in' ? '+' : '-') + money(r.a) + '</span> ' + esc(r.n) +
        '<div class="sm">' + esc(r.d) + '</div>' +
        '<form method="post" action="/"><input type="hidden" name="action" value="del">' +
        '<input type="hidden" name="id" value="' + esc(r.id) + '">' +
        '<button class="d" type="submit">حذف</button></form></div>';
    });
    if (!list.length) html += '<p>لا توجد معاملات بعد.</p>';

    return send(200, page(html));
  } catch (e) {
    return send(500, page('<p>خطأ: ' + esc(e.message) + '</p>'));
  }
};
