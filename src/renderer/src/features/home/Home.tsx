// 主界面：当前房间/对局、玩家查询、对局档案 + 行车记录仪（并排）、卡组工具。
// 所有东西都在这一页，不再有右侧抽屉，也不再有顶栏的档案/工具入口。
import CurrentMatch from '../current/CurrentMatch'
import PlayerPanel from '../players/PlayerPanel'
import Archive from '../archive/Archive'
import Replays from '../replay/Replays'
import Decks from '../decks/Decks'
import Bans from '../decks/Bans'

export default function Home({ onOpenReport }: { onOpenReport: (fid: string) => void }): React.JSX.Element {
  return (
    <>
      <CurrentMatch />
      <PlayerPanel />
      <div className="cols stretch">
        <Archive onOpen={onOpenReport} />
        <Replays />
      </div>
      <Decks />
      <Bans />
    </>
  )
}
