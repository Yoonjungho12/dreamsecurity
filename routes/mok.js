const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
const supabase = require('../lib/supabase');

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
const resultUrl = 'https://www.yeogidot.com/mok/mok_std_result';

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
  return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
}

function checkIsAdult(birthday) {
  const year = parseInt(birthday.substring(0, 4));
  const month = parseInt(birthday.substring(4, 6)) - 1;
  const day = parseInt(birthday.substring(6, 8));
  const birth = new Date(year, month, day);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;

  return age >= 19;
}

// ✅ 인증 요청 API
router.post('/mok_std_request', (req, res) => {
  console.log('🔍 인증 요청 함수 실행');
  console.log('📥 요청 바디:', req.body);

  if (req.session.clientTxId && req.session.userId && req.session.encrypted) {
    console.log('✅ 세션 재요청 감지 → 재사용');
    return res.json({
      usageCode: '01005',
      serviceId: mobileOK.getServiceId(),
      encryptReqClientInfo: req.session.encrypted,
      serviceType: 'telcoAuth',
      retTransferType: 'MOKToken',
      returnUrl: resultUrl,
      resultType: 'json',
    });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId가 필요합니다' });

  const clientTxId = clientPrefix + uuid();
  const fullTxId = `${clientTxId}|${getCurrentDate()}`;
  const encrypted = mobileOK.RSAEncrypt(fullTxId);

  req.session.userId = userId;
  req.session.clientTxId = clientTxId;
  req.session.encrypted = encrypted;

  const payload = {
    usageCode: '01005',
    serviceId: mobileOK.getServiceId(),
    encryptReqClientInfo: encrypted,
    serviceType: 'telcoAuth',
    retTransferType: 'MOKToken',
    returnUrl: resultUrl,
    resultType: 'json',
  };

  console.log('📤 응답:', payload);
  res.json(payload);
});

// ✅ 인증 결과 API
router.post('/mok_std_result', async (req, res) => {
  console.log('🔓 인증 결과 수신');
  console.log('📥 요청 바디:', req.body);

  try {
    const decoded = decodeURIComponent(req.body.data);
    const parsed = JSON.parse(decoded);
    console.log("✅ 디코딩된 MOKToken 데이터:", parsed);

    const token = parsed.encryptMOKKeyToken;
    if (!token) return res.status(400).send('-1|토큰 없음');

    const mokRes = await axios.post(MOK_RESULT_REQUEST_URL, { encryptMOKKeyToken: token });
    const encrypted = mokRes.data.encryptMOKResult;
    if (!encrypted) return res.status(400).send('-2|암호화된 결과 없음');

    const decryptedJson = mobileOK.getResult(encrypted);
    const decrypted = JSON.parse(decryptedJson);
    console.log('✅ 복호화된 사용자 정보:', decrypted);

    const sessionTxId = req.session.clientTxId;
    const resultTxId = decrypted.clientTxId?.split('|')[0];
    if (sessionTxId !== resultTxId) {
      console.warn("❌ 거래번호 불일치");
      return res.status(403).send('-4|세션 불일치');
    }

    const userId = req.session.userId;
    if (!userId) {
      console.warn("❌ 세션에 userId 없음");
      return res.status(400).json({ error: "세션에 userId 없음" });
    }

    let isAdult = false;
    if (decrypted.userBirthday) {
      isAdult = checkIsAdult(decrypted.userBirthday);
      console.log(`🎂 생년월일: ${decrypted.userBirthday}, 성인 여부: ${isAdult}`);
    }

    if (isAdult) {
      const { error } = await supabase
        .from('profiles')
        .update({ is_adult: true })
        .eq('user_id', userId);

      if (error) {
        console.error('❌ Supabase 업데이트 오류:', error);
      } else {
        console.log(`✅ [${userId}] is_adult 업데이트 완료`);
      }
    }

    // ✅ 세션 정리!
    req.session.destroy(err => {
      if (err) {
        console.error('❌ 세션 제거 실패:', err);
      } else {
        console.log('✅ 세션 정상 제거 완료');
      }
    });

    res.json({
      errorCode: '2000',
      resultMsg: '성공',
      data: decrypted,
      isAdult,
    });

  } catch (err) {
    console.error('❌ 인증 결과 처리 오류:', err);
    res.status(500).send('-9|서버 내부 오류');
  }
});

module.exports = router;