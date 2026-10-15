// 비정상상황 앱 설정
// - SUPABASE_KEY 는 '공개용(publishable)' 키입니다. 코드에 있어도 안전하며, 접근 제한은 DB 보안 규칙(RLS)이 담당합니다.
// - 절대로 secret / service_role 키를 넣지 마세요.
window.APP_CONFIG = {
  SUPABASE_URL: "https://hjqanyudhafuwyjdaifa.supabase.co",
  SUPABASE_KEY: "sb_publishable_6OmTmY2fKv4l3Ex7ZCjn7Q_S-pouW2z",
  // 사번을 로그인 계정(이메일 형식)으로 바꿀 때 뒤에 붙는 주소. 실제 메일은 발송되지 않습니다.
  EMAIL_DOMAIN: "strikeboard.app"
};
