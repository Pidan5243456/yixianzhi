const crypto=require('node:crypto');
const DM_ENDPOINT=process.env.DM_ENDPOINT||'https://dm.aliyuncs.com/';
const DM_ACCOUNT=process.env.DM_ACCOUNT||'';
const DM_FROM_ALIAS='衣先知';
const DM_ACCESS_KEY_ID=process.env.DM_ACCESS_KEY_ID||'';
const DM_ACCESS_KEY_SECRET=process.env.DM_ACCESS_KEY_SECRET||'';
function pctEncode(s) {
  return encodeURIComponent(s).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

async function sendMail(email, code) {
  const params = {
    Action: "SingleSendMail",
    AccountName: DM_ACCOUNT,
    AddressType: "1",              // 1 = 使用发信地址作为管理地址
    ReplyToAddress: "false",
    ToAddress: email,
    Subject: "衣先知 · 登录验证码",
    HtmlBody: `<p>您的衣先知登录验证码是 <b style="font-size:18px;letter-spacing:2px">${code}</b>，5 分钟内有效。</p><p>如非本人操作，请忽略此邮件。</p>`,
    FromAlias: DM_FROM_ALIAS,
    Format: "JSON",
    Version: "2015-11-23",
    AccessKeyId: DM_ACCESS_KEY_ID,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
  };
  const canonical = Object.keys(params).sort()
    .map(k => `${pctEncode(k)}=${pctEncode(params[k])}`).join("&");
  const stringToSign = `POST&${pctEncode("/")}&${pctEncode(canonical)}`;
  const signature = crypto.createHmac("sha1", DM_ACCESS_KEY_SECRET + "&").update(stringToSign).digest("base64");
  const body = `${canonical}&Signature=${pctEncode(signature)}`;

  const resp = await fetch(DM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`DirectMail ${resp.status}: ${data.Code || ""} ${data.Message || "发送失败"}`);
  return data;
}


module.exports={sendMail,enabled:!!(DM_ACCOUNT&&DM_ACCESS_KEY_ID&&DM_ACCESS_KEY_SECRET)};
