const express = require('express');
const router = express.Router();
const axios = require('axios');
const urlencode = require('urlencode');
const path = require('path');

// mok_Key_Manager 불러오기 + 🔐 keyInit까지 포함
let mobileOK;
try {
  mobileOK = require('../mok_Key_Manager_v1.0.3.js');
  console.log('✅ mok_Key_Manager 로드 성공');

  const keyPath = path.join(__dirname, '..', 'mok_keyInfo.dat');
  const password = 'thdwkd12!';
  mobileOK.keyInit(keyPath, password);
  console.log('🔐 keyInit 성공');
} catch (e) {
  console.error('❌ mok_Key_Manager 로드 또는 keyInit 실패:', e);
  process.exit(1);
}

// 상수
const clientPrefix = 'YEOGIDOT';
const MOK_RESULT_REQUEST_URL = 'https://scert.mobile-ok.com/gui/service/v1/result/request';
const resultUrl = 'http://localhost:4000/mok/mok_std_result';

// 유틸리티 함수
function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// ✅ 인증 요청 API
router.post('/mok_std_request', (req, res) => {
  console.log('🔍 인증 요청 함수 실행');
  console.log('📥 요청 바디:', req.body);

  const clientTxId = clientPrefix + uuid();
  req.session.clientTxId = clientTxId;

  const fullTxId = clientTxId + '|' + getCurrentDate();
  const encrypted = mobileOK.RSAEncrypt(fullTxId);

  const payload = {
    usageCode: '01005',
    serviceId: mobileOK.getServiceId(),
    encryptReqClientInfo: encrypted,
    serviceType: 'telcoAuth',
    retTransferType: 'MOKToken',
    returnUrl: resultUrl,
    resultType: 'json'
  };

  console.log('📤 응답:', payload);
  res.json(payload);
});

// ✅ 인증 결과 API
router.post('/mok_std_result', async (req, res) => {
  console.log('🔍 인증 결과 함수 실행');
  console.log('📥 요청 바디:', req.body);

  try {
    const body = req.body;
    const decoded = decodeURIComponent(JSON.parse(body).data);
    const parsed = JSON.parse(decoded);
    const token = parsed.encryptMOKKeyToken;

    if (!token) return res.status(400).send('-1|토큰 없음');

    const mokRes = await axios.post(MOK_RESULT_REQUEST_URL, { encryptMOKKeyToken: token });
    const encrypted = mokRes.data.encryptMOKResult;
    if (!encrypted) return res.status(400).send('-1|암호화된 결과 없음');

    const decryptedJson = mobileOK.getResult(encrypted);
    const decrypted = JSON.parse(decryptedJson);

    const sessionTxId = req.session.clientTxId;
    const receivedTxId = decrypted.clientTxId?.split('|')[0];

    if (sessionTxId !== receivedTxId) {
      return res.status(403).send('-4|세션 불일치');
    }

    res.json({
      errorCode: '2000',
      resultMsg: '성공',
      data: decrypted
    });
  } catch (err) {
    console.error('❌ 결과 처리 중 오류:', err);
    res.status(500).send('-9|서버 내부 오류');
  }
});

module.exports = router;