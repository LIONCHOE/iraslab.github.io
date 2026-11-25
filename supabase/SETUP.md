# 개인 배드민턴 모임 연결

1. 개인 테스트 프로젝트의 SQL Editor에서 `migrations/20261124_live_league.sql`을 한 번 실행합니다. 이 파일은 모임 테이블, 읽기 정책, 점수 기록 함수, 실시간 구독을 구성합니다.
2. Supabase Authentication의 Sign In / Providers에서 이메일 로그인과 Anonymous Sign-Ins를 활성화합니다. Users에서 개설자 계정을 만들고 해당 계정의 User UID를 확인합니다. 개설자 비밀번호는 본인이 관리합니다.
3. SQL Editor에서 다음 쿼리의 UUID를 개설자의 User UID로 바꾸고 실행합니다.

```sql
insert into iras_private.organizers(uid) values ('개설자의 User UID') on conflict do nothing;
```

4. 개인 사이트의 `badminton/live-config.js`에 Project URL과 브라우저용 publishable key를 설정합니다. 이 파일은 공개됩니다. 서비스 역할 키나 데이터베이스 연결 문자열은 사용하지 않습니다.
5. 관리자 Badminton에서 **공유 모임 편성·개설**을 선택합니다. 개설자 로그인 후 참석자·게스트와 코트를 설정하고 **균형 팀 편성 → 리그 대진 만들기 → 편성한 모임 열기**를 누릅니다. 공유 모임 링크는 개인 사이트의 배드민턴 첫 화면에도 표시됩니다.
6. 개설자 화면에서 경기지를 인쇄합니다. 이 QR을 스캔한 참가자는 모임 코드 입력 없이 점수를 등록·수정할 수 있습니다. QR 사진을 받은 사람도 같은 권한을 갖습니다. 일반 모임 링크와 이전에 인쇄한 조회용 QR은 일정과 순위를 보여줍니다. 마감한 뒤 확정 기록 MD를 다운로드하여 기존 관리자의 완료 MD 가져오기와 업로드로 게시합니다. 재게시에는 기존 모임 ID가 쓰입니다.

모임명, 날짜, 조별 선수 이름, 경기 결과는 링크를 연 방문자가 볼 수 있습니다. 휴대폰 두 대로 점수 동기화, 마감 후 읽기, 실제 인쇄물 QR 인식을 확인한 후 사용합니다.

## 기존 개설자에게 로그인 아이디 연결

1. 이미 경기를 개설한 계정은 그대로 사용합니다. SQL Editor에서 `migrations/20261125_organizer_alias.sql`의 내용만 한 번 실행합니다. 등록된 개설자가 정확히 한 명인지 검사하고, 성공하면 데이터베이스가 두 번째 개설자 등록을 차단합니다. 여러 명이면 전체 변경이 취소되므로 담당자를 먼저 확인합니다.
2. 같은 프로젝트의 Edge Functions에서 함수 이름을 `organizer-login`으로 지정하고 `functions/organizer-login/index.ts`의 내용을 배포합니다. 로그인 전에 호출하는 함수이므로 이 함수의 **Verify JWT**를 끕니다. 함수는 서버 환경에서 제공되는 Supabase 키를 사용해 기존 비밀번호를 Supabase Auth로 확인합니다. CLI 사용 시 저장소에서 `npx supabase functions deploy organizer-login --project-ref <프로젝트-ref> --no-verify-jwt`를 실행합니다.
3. 기존 개설자가 이메일과 비밀번호로 로그인한 후 **로그인 아이디 등록**을 열어 영문자로 시작하는 3~24자의 아이디를 저장합니다. 이후 아이디 또는 기존 이메일과 같은 비밀번호로 로그인합니다. 등록에 성공하면 화면에 저장된 소문자 아이디가 표시됩니다.
4. QR 점수 입력은 익명 인증을 사용합니다. 프로젝트의 익명 로그인과 신규 사용자 생성 설정을 유지합니다. 개설자 한 명 제한은 배드민턴 개설자 테이블에 적용됩니다.
