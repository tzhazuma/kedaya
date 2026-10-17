import { KdyLegalDoc } from '../../../components/KdyLegalDoc'
import { LEGAL_UPDATED_AT, TERMS_SECTIONS } from '../../../content/legal'

/**
 * 用户协议页。
 *
 * 内容全部来自 `presentation/content/legal.ts`（与隐私页共享同一份真相来源），
 * 本页只负责标题与排版 —— 审核时被问"协议在哪"就能直接指出这个页面。
 */
export default function TermsPage() {
  return (
    <KdyLegalDoc
      title='用户协议'
      subtitle='使用可达鸭前，请先看完这份约定。继续使用即表示你接受本协议。'
      updatedAt={LEGAL_UPDATED_AT}
      sections={TERMS_SECTIONS}
    />
  )
}
