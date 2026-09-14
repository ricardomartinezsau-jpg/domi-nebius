import { DomiApp } from '@/components/domi-app'
import { LocaleProvider } from '@/components/locale'

export default function Home() {
  return <LocaleProvider><DomiApp /></LocaleProvider>
}
