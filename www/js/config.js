/* Supabase 연결 정보 — 공개용(publishable) 키만 넣습니다. 비밀(service_role/secret) 키는 절대 넣지 마세요. */
window.APP_CONFIG = {
  supabaseUrl: 'https://api.worknium.co.kr', // 홈 서버 (Cloudflare 터널 공개, 테일스케일 불필요 — 2026-11-18). 예전: https://workniumserver.tail876d9c.ts.net (테일스케일), https://lesmddcswhyioflnxqzg.supabase.co (클라우드)
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkzMDg4MTAyLCJleHAiOjE5NTA3NjgxMDJ9.--g4x8wsdhh2j9OKHkPdUtzVJCk05EewsSj3OZExDYA', // 홈 서버 anon(공개용) 키
};
