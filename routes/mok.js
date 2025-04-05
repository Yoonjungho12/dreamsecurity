const express = require('express');
const router = express.Router();
const axios = require('axios');
const urlencode = require('urlencode');
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

// ✅ 유틸리티 함수들
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

function checkIsAdult(birthdayString) {
  // YYYYMMDD 형식의 생년월일을 파싱
  const year = parseInt(birthdayString.substring(0, 4));
  const month = parseInt(birthdayString.substring(4, 6)) - 1; // 월은 0부터 시작
  const day = parseInt(birthdayString.substring(6, 8));
  
  const birthDate = new Date(year, month, day);
  const today = new Date();
  
  // 만 나이 계산
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age >= 19;
}

// ✅ 인증 요청 API
router.post('/mok_std_request', (req, res) => {
  console.log('🔍 인증 요청 함수 실행');
  console.log('📥 요청 바디:', req.body);

  // 1️⃣ 세션에 clientTxId가 있으면 재호출 → 그냥 통과시킴
  if (req.session.clientTxId && req.session.userId) {
    console.log('✅ 세션에 clientTxId 있음 → 재호출로 판단 → OK 응답');
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

  // 2️⃣ 첫 호출 → userId 필요
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId가 필요합니다' });
  }

  const clientTxId = clientPrefix + uuid();
  req.session.userId = userId;
  req.session.clientTxId = clientTxId;

  const fullTxId = clientTxId + '|' + getCurrentDate();
  const encrypted = mobileOK.RSAEncrypt(fullTxId);
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
  console.log('🔍 인증 결과 함수 실행');
  console.log('📥 요청 바디:', req.body);

  try {
    // 1️⃣ 클라이언트로부터 받은 암호화된 결과 해석
    const decoded = decodeURIComponent(req.body.data); // ★ 여기 JSON.parse 제거 주의!
    const parsed = JSON.parse(decoded);

    console.log("✅ 디코딩된 MOKToken 데이터:", parsed);

    const token = parsed.encryptMOKKeyToken;
    if (!token) {
      console.warn("❌ MOKToken 없음");
      return res.status(400).send('-1|토큰 없음');
    }

    // 2️⃣ MOK 서버에 최종 결과 요청
    const mokRes = await axios.post(MOK_RESULT_REQUEST_URL, { encryptMOKKeyToken: token });
    const encrypted = mokRes.data.encryptMOKResult;

    if (!encrypted) {
      console.warn("❌ MOKResult 없음");
      return res.status(400).send('-2|암호화된 결과 없음');
    }

    // 3️⃣ 복호화
    const decryptedJson = mobileOK.getResult(encrypted);
    const decrypted = JSON.parse(decryptedJson);

    console.log("✅ 복호화된 사용자 정보:", decrypted);

    // 4️⃣ 거래번호 확인
    const sessionTxId = req.session.clientTxId;
    const receivedTxId = decrypted.clientTxId?.split('|')[0];

    if (sessionTxId !== receivedTxId) {
      console.warn("❌ 거래번호 불일치");
      return res.status(403).send('-4|세션 불일치');
    }

    // 5️⃣ 세션에서 userId 추출
    const userId = req.session.userId;
    if (!userId) {
      console.warn("❌ 세션에 userId 없음");
      return res.status(400).json({ error: "세션에 userId 없음" });
    }

    // 6️⃣ 성인 여부 계산
    let isAdult = false;
    if (decrypted.userBirthday) {
      isAdult = checkIsAdult(decrypted.userBirthday);
      console.log("🎂 생년월일:", decrypted.userBirthday, "→ 성인 여부:", isAdult);
    }

    // 7️⃣ Supabase에 저장
    if (isAdult) {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          user_id: userId,
          is_adult: true,
          verified_at: new Date().toISOString(),
        });

      if (error) {
        console.error('❌ Supabase 업데이트 오류:', error);
      } else {
        console.log(`✅ [${userId}] is_adult = true 업데이트 완료`);
      }
    }

    // 8️⃣ 클라이언트 응답
    res.json({
      errorCode: '2000',
      resultMsg: '성공',
      data: decrypted,
      isAdult,
    });

  } catch (err) {
    console.error('❌ 인증 결과 처리 중 오류:', err);
    res.status(500).send('-9|서버 내부 오류');
  }
});

module.exports = router;