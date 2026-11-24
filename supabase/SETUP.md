# 개인 배드민턴 모임 연결

1. 개인 테스트 프로젝트의 SQL Editor에서 `migrations/20261124_live_league.sql`을 한 번 실행합니다. 이 파일은 모임 테이블, 읽기 정책, 점수 기록 함수, 실시간 구독을 구성합니다.
2. Supabase Authentication의 Sign In / Providers에서 이메일 로그인과 Anonymous Sign-Ins를 활성화합니다. Users에서 개설자 계정을 만들고 해당 계정의 User UID를 확인합니다. 개설자 비밀번호는 본인이 관리합니다.
3. SQL Editor에서 다음 쿼리의 UUID를 개설자의 User UID로 바꾸고 실행합니다.

```sql
insert into iras_private.organizers(uid) values ('개설자의 User UID') on conflict do nothing;
```

4. 개인 사이트의 `badminton/live-config.js`에 Project URL과 브라우저용 publishable key를 설정합니다. 이 파일은 공개됩니다. 서비스 역할 키나 데이터베이스 연결 문자열은 사용하지 않습니다.
5. 관리자 Badminton에서 **공유 모임 편성·개설**을 선택합니다. 개설자 로그인 후 참석자·게스트와 코트를 설정하고 **균형 팀 편성 → 리그 대진 만들기 → 편성한 모임 열기**를 누릅니다. 공유 모임 링크는 개인 사이트의 배드민턴 첫 화면에도 표시됩니다.
6. 경기지를 인쇄하고 모임 입력 코드를 참가자에게 공유합니다. 참가자는 QR로 같은 주소를 열고 결과 저장 시 해당 기기에서 코드를 입력합니다. 마감한 뒤 확정 기록 MD를 다운로드하여 기존 관리자의 완료 MD 가져오기와 업로드로 게시합니다. 재게시에는 기존 모임 ID가 쓰입니다.

모임명, 날짜, 조별 선수 이름, 경기 결과는 링크를 연 방문자가 볼 수 있습니다. 휴대폰 두 대로 점수 동기화, 마감 후 읽기, 실제 인쇄물 QR 인식을 확인한 후 사용합니다.
