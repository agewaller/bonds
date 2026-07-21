// 画面別 UI 辞書 (lib/i18n.ts が合流する)。既定は日本語 = 現行文言そのまま。
import type { DictEntry } from "./i18n";

export const DICT_SECTIONS: Record<string, DictEntry> = {
  // 共通
  x_error_generic: { ja: "うまくいきませんでした", en: "Something went wrong" },
  x_error_retry_later: {
    ja: "うまくいきませんでした。しばらくしてからお試しください",
    en: "Something went wrong. Please try again in a little while",
  },
  x_back_contacts: { ja: "連絡帳へ戻る", en: "Back to contacts" },

  // AuthBar
  x_user_honorific: { ja: " さん", en: "" },

  // Fold (折りたたみパネル)
  x_fold_close: { ja: "たたむ", en: "Close" },
  x_fold_open: { ja: "ひらく", en: "Open" },

  // MessagesSection (やりとり)
  x_msg_heading: { ja: "やりとり (メッセージ)", en: "Messages" },
  x_msg_empty: {
    ja: "まだやりとりはありません。最初のひとことを送ってみませんか。",
    en: "No messages yet. How about sending a first hello?",
  },
  x_msg_you: { ja: "あなた", en: "You" },
  x_msg_them: { ja: "この方", en: "Them" },
  x_msg_status_draft: { ja: " ・ 下書き", en: " ・ draft" },
  x_msg_status_failed: { ja: " ・ 送れませんでした", en: " ・ could not be sent" },
  x_msg_subject_label: { ja: "題名 (任意)", en: "Subject (optional)" },
  x_msg_body_label: { ja: "メッセージ", en: "Message" },
  x_msg_placeholder: {
    ja: "お元気ですか。ふと思い出してご連絡しました。",
    en: "How are you? You came to mind, so I thought I would write.",
  },
  x_msg_send: { ja: "送る", en: "Send" },
  x_msg_save_draft: { ja: "下書きとして残す", en: "Save as draft" },
  x_msg_sent_recorded: {
    ja: "お送りしました。やりとりの記録にも残しています",
    en: "Sent. It has also been added to your records",
  },
  x_msg_send_failed_draft: {
    ja: "送信できませんでした。下書きとして残しています",
    en: "It could not be sent. It has been kept as a draft",
  },
  x_msg_saved_draft: { ja: "下書きとして残しました", en: "Saved as a draft" },
  x_msg_need_email: {
    ja: "メールアドレスを登録すると、ここからそのまま送れます。",
    en: "Add an email address to send directly from here.",
  },

  // SharesSection (時間・知恵・モノのシェア)
  x_share_heading: { ja: "時間・知恵・モノのシェア", en: "Sharing time, knowledge and things" },
  x_share_desc: {
    ja: "お金を介さないやりとりが、つながりを深くします。手伝えること、教えられること、お譲りできるものを気軽に。",
    en: "Exchanges that do not involve money deepen relationships. Feel free to offer what you can help with, teach or give.",
  },
  x_share_kind_time: { ja: "時間", en: "Time" },
  x_share_kind_wisdom: { ja: "知恵", en: "Knowledge" },
  x_share_kind_thing: { ja: "モノ", en: "Things" },
  x_share_dir_offer: { ja: "差し出す", en: "Offer" },
  x_share_dir_request: { ja: "お願い", en: "Request" },
  x_share_dir_inbound: { ja: "いただいた", en: "Received" },
  x_share_status_proposed: { ja: "準備中", en: "In preparation" },
  x_share_status_sent: { ja: "お知らせ済み", en: "Notified" },
  x_share_status_accepted: { ja: "受けてもらえました", en: "Accepted" },
  x_share_status_declined: { ja: "今回は見送り", en: "Declined this time" },
  x_share_status_fulfilled: { ja: "実現しました", en: "Fulfilled" },
  x_share_status_cancelled: { ja: "取りやめ", en: "Called off" },
  x_share_recorded_inbound: {
    ja: "いただいた記録を残しました",
    en: "The received item has been recorded",
  },
  x_share_prepared: {
    ja: "準備しました。お知らせすると相手用のリンクが発行されます",
    en: "Prepared. When you notify them, a link for them will be created",
  },
  x_share_notified_mail: {
    ja: "メールでお知らせしました。下のリンクを別の方法で伝えても構いません",
    en: "Notified by email. You may also share the link below in another way",
  },
  x_share_link_ready: {
    ja: "相手用のリンクができました。メールや口頭でお伝えください",
    en: "The link for them is ready. Share it by email or in person",
  },
  x_share_link_label: { ja: "相手用リンク:", en: "Link for them:" },
  x_share_aria_direction: { ja: "やりとりの向き", en: "Direction" },
  x_share_aria_kind: { ja: "何を", en: "What to share" },
  x_share_opt_offer: { ja: "差し出す", en: "Offer" },
  x_share_opt_request: { ja: "お願いする", en: "Make a request" },
  x_share_opt_inbound: { ja: "いただいた記録", en: "Record something received" },
  x_share_opt_time: { ja: "時間 (手伝う・付き添う)", en: "Time (helping, accompanying)" },
  x_share_opt_wisdom: { ja: "知恵 (教える・相談に乗る)", en: "Knowledge (teaching, advising)" },
  x_share_opt_thing: { ja: "モノ (譲る・貸す)", en: "Things (giving, lending)" },
  x_share_title_label: { ja: "内容", en: "Details" },
  x_share_title_ph: {
    ja: "例: 引っ越しを手伝えます / 確定申告の相談に乗れます / 本をお貸しします",
    en: "For example: I can help with moving / I can advise on tax filing / I can lend books",
  },
  x_share_message_label: { ja: "ひとこと (任意)", en: "A short note (optional)" },
  x_share_btn_record: { ja: "記録する", en: "Record" },
  x_share_btn_prepare: { ja: "準備する", en: "Prepare" },
  x_share_btn_send: { ja: "お知らせする (リンク発行)", en: "Notify (create link)" },
  x_share_btn_fulfilled: { ja: "実現した", en: "It happened" },
  x_share_btn_cancel: { ja: "取りやめる", en: "Call it off" },

  // AvailabilityCalendar (空き時間カレンダー)
  x_cal_free_slot: { ja: "空き (タップで消す)", en: "Free (tap to remove)" },

  // resources (差し出せるもの)
  x_res_title: { ja: "差し出せるもの", en: "What you can offer" },
  x_res_desc: {
    ja: "あなたがシェアできる時間・知恵・モノをここに置いておくと、どなたかの力になりたいとき、すぐに差し出せます。",
    en: "Keep the time, knowledge and things you can share here, so you can offer them right away when you want to help someone.",
  },
  x_res_new: { ja: "新しく登録する", en: "Add new" },
  x_res_aria_kind: { ja: "種類", en: "Kind" },
  x_res_title_ph: {
    ja: "例: 事業計画の壁打ちに乗れます",
    en: "For example: I can be a sounding board for business plans",
  },
  x_res_desc_label: { ja: "くわしく (任意)", en: "More details (optional)" },
  x_res_avail_label: { ja: "いつなら・どのくらい (任意)", en: "When and how often (optional)" },
  x_res_avail_ph: {
    ja: "例: 平日夜 / 月2回まで",
    en: "For example: weekday evenings / up to twice a month",
  },
  x_res_register: { ja: "登録する", en: "Add" },
  x_res_empty: {
    ja: "まだ登録がありません。小さなことで構いません。",
    en: "Nothing here yet. Small things are welcome.",
  },
  x_res_archive: { ja: "しまう", en: "Put away" },

  // share/[token] (相手向けの公開ページ。第三者が見るので特に丁寧に)
  x_pub_kind_time: { ja: "お手伝い", en: "help with something" },
  x_pub_kind_wisdom: { ja: "ご相談・アドバイス", en: "advice or consultation" },
  x_pub_kind_thing: { ja: "お譲り・お貸し", en: "something to give or lend" },
  x_pub_kind_fallback: { ja: "ご案内", en: "a message" },
  x_pub_notice_before: { ja: "", en: "You have received a note about " },
  x_pub_notice_after: { ja: "のお知らせが届いています", en: "" },
  x_pub_not_found: {
    ja: "このページは見つかりませんでした。リンクの期限が切れているかもしれません。",
    en: "This page could not be found. The link may have expired.",
  },
  x_pub_loading: { ja: "読み込んでいます…", en: "Loading…" },
  x_pub_done_title: { ja: "お返事を伝えました", en: "Your reply has been delivered" },
  x_pub_done_accepted: {
    ja: "ありがとうございます。送り主に届きました。このままお待ちください。",
    en: "Thank you. Your reply has reached the sender. Please wait to hear from them.",
  },
  x_pub_done_declined: {
    ja: "承知しました。お気遣いなく。お返事は送り主に届いています。",
    en: "Understood, and please do not worry. Your reply has reached the sender.",
  },
  x_pub_note_ph: {
    ja: "例: ありがとうございます。ぜひお願いします。",
    en: "For example: Thank you, I would be glad to.",
  },
  x_pub_btn_accept_request: { ja: "お引き受けする", en: "I will take this on" },
  x_pub_btn_accept: { ja: "受け取る", en: "Accept" },
  x_pub_btn_decline: { ja: "今回は見送る", en: "Not this time" },
  x_pub_no_login: {
    ja: "ログインは要りません。押すとお返事だけが送り主に届きます。",
    en: "No sign-in is needed. Only your reply will be sent to the sender.",
  },
  x_pub_closed: {
    ja: "このお知らせにはすでにお返事済みか、受付が終わっています。",
    en: "This notice has already been answered, or it is no longer open.",
  },

  // login
  x_login_busy: { ja: "サインインしています…", en: "Signing in…" },
  x_login_failed: {
    ja: "サインインできませんでした。もう一度お試しください",
    en: "Could not sign in. Please try again",
  },
  x_login_unconfigured_before: {
    ja: "サインインの準備がまだ済んでいません (開発中はそのまま",
    en: "Sign-in is not set up yet (during development you can use the",
  },
  x_login_unconfigured_link: { ja: " 連絡帳 ", en: " contacts " },
  x_login_unconfigured_after: { ja: "を使えます)。", en: "page as is)." },
};
