import { useState } from 'react'
import { LibraryPage } from './pages/LibraryPage'
import { ReaderPage } from './pages/ReaderPage'
import { TrashPage } from './pages/TrashPage'

type View =
  | { name: 'library' }
  | { name: 'reader'; id: string; page?: number }
  | { name: 'trash' }

export function App() {
  const [view, setView] = useState<View>({ name: 'library' })

  if (view.name === 'reader') {
    return (
      <ReaderPage
        key={view.id}
        id={view.id}
        initialPage={view.page}
        onBack={() => setView({ name: 'library' })}
      />
    )
  }

  if (view.name === 'trash') {
    return <TrashPage onBack={() => setView({ name: 'library' })} />
  }

  return (
    <LibraryPage
      onOpen={(id, page) => setView({ name: 'reader', id, page })}
      onOpenTrash={() => setView({ name: 'trash' })}
    />
  )
}
