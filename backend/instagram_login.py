# -*- coding: utf-8 -*-
"""
인스타그램 라이브 댓글 연동을 위한 1회성 로그인 스크립트.

이 스크립트를 실행하면 브라우저 창이 하나 뜹니다 - 거기서 직접 인스타그램에 로그인하세요
(아이디/비밀번호는 여러분이 그 브라우저 화면에 직접 입력하는 것이라, 이 코드나 게임 서버
어디에도 저장되지 않습니다). 2단계 인증이 있으면 그것도 그 창에서 그대로 진행하면 됩니다.

로그인이 끝나면 이 터미널로 돌아와서 Enter를 누르세요. 그러면 로그인 세션(쿠키)이
backend/instagram_auth.json 파일로 저장되고, 그 이후로는 server.py가 이 파일을 읽어서
매번 로그인할 필요 없이 자동으로 로그인된 상태로 라이브 댓글을 가져옵니다.

세션은 인스타그램이 로그아웃시키기 전까지 계속 유효합니다. 나중에 "로그인이 풀렸다"는
에러가 나면 이 스크립트를 한 번 더 실행해서 다시 저장하면 됩니다.

실행: backend 폴더에서 `python instagram_login.py`
"""
import os

from playwright.sync_api import sync_playwright

AUTH_PATH = os.path.join(os.path.dirname(__file__), 'instagram_auth.json')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto('https://www.instagram.com/accounts/login/')

        print('브라우저 창에서 인스타그램에 로그인해주세요.')
        input('로그인을 마쳤으면 이 터미널로 돌아와서 Enter를 누르세요...')

        context.storage_state(path=AUTH_PATH)
        print(f'저장 완료: {AUTH_PATH}')
        browser.close()


if __name__ == '__main__':
    main()
