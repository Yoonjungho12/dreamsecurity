const express = require('express');
const router = express.Router();
const axios = require('axios');
const urlencode = require('urlencode');
const path = require('path');

// ✅ mok_Key_Manager 로드 + keyInit
let mobileOK;
try {
  mobileOK = require('../mok_Key_Manager_v1.0.3.js');
  const keyPath = path.join(__dirname, '..', 'mok_keyInfo.dat');
  mobileOK.keyInit(keyPath, 'thdwkd12!');
  console.log('✅ mok_Key_Manager 로드 및 keyInit 성공');
} catch (e) {
  console.error('❌ mok_Key_Manager 로드 또는 keyInit 실패:', e);
  process.exit(1);
}

// ✅ 상수
const clientPrefix = 'YEOGIDOT';
const MOK_RESULT_REQUEST_URL = 'https://scert.mobile-ok.com/gui/service/v1/result/request';
const resultUrl = 'https://www.yeogidot.com/mok/mok_std_result'; // 🚨 Render 배포 시 변경 필수

// ✅ 인증 요청 API
router.post('/mok_std_request', (req, res) => {
  console.log('\n🔐 [mok_std_request] 인증 요청 시작');

  const clientTxId = clientPrefix + uuid();
  req.session.clientTxId = clientTxId;

  const fullTxId = clientTxId + '|' + getCurrentDate();
  const encrypted = mobileOK.RSAEncrypt(fullTxId);

  const payload = {
    usageCode: '01005', // 본인확인용
    serviceId: mobileOK.getServiceId(),
    encryptReqClientInfo: encrypted,
    serviceType: 'telcoAuth',
    retTransferType: 'MOKToken',
    returnUrl: resultUrl,
    resultType: 'json',
  };

  console.log('📤 인증 요청 Payload:', payload);
  res.json(payload);
});

// ✅ 인증 결과 API
router.post('/mok_std_result', async (req, res) => {
  console.log('\n🔓 [mok_std_result] 인증 결과 수신');

  try {
    const raw = req.body;
    const decoded = decodeURIComponent(JSON.parse(raw).data);
    const parsed = JSON.parse(decoded);

    const token = parsed.encryptMOKKeyToken;
    if (!token) return res.status(400).send('-1|토큰 없음');

    // MOK 서버로 결과 요청
    const mokRes = await axios.post(MOK_RESULT_REQUEST_URL, { encryptMOKKeyToken: token });
    const encrypted = mokRes.data.encryptMOKResult;
    if (!encrypted) return res.status(400).send('-2|암호화된 결과 없음');

    const decryptedJson = mobileOK.getResult(encrypted);
    const decrypted = JSON.parse(decryptedJson);

    // 거래 ID 검증
    const sessionTxId = req.session.clientTxId;
    const resultTxId = decrypted.clientTxId?.split('|')[0];
    if (sessionTxId !== resultTxId) return res.status(403).send('-4|세션 불일치');

    // 결과 응답
    console.log('✅ 복호화 성공:', decrypted.userName, decrypted.userPhone);
    res.json({
      errorCode: '2000',
      resultMsg: '성공',
      data: decrypted,
    });
  } catch (err) {
    console.error('❌ 인증 결과 처리 중 오류:', err.message);
    res.status(500).send('-9|서버 내부 오류');
  }
});

// ✅ 유틸 함수들
function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getCurrentDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

module.exports = router;