import { TriageApp } from '@/components/triage-app'

export default function Home() {
  return (
    <main>
      <h1>Domi — Brain Dump Triage</h1>
      <p className="tagline">
        Suelta lo que traes en la cabeza. Meta Llama 3.3 70B, servido por Nebius Token Factory, lo
        reparte en 4 bandejas de vida, ordena las dependencias, lo parte en micro-pasos y te da un
        primer movimiento de 2 minutos.
      </p>
      <TriageApp />
      <footer>
        Integración: Nebius Token Factory ·{' '}
        <a href="https://github.com/ricardomartinezsau-jpg/domi-nebius" target="_blank" rel="noreferrer">
          código en GitHub
        </a>{' '}
        · ver{' '}
        <a
          href="https://github.com/ricardomartinezsau-jpg/domi-nebius/blob/main/EVALUATION.md"
          target="_blank"
          rel="noreferrer"
        >
          evaluación
        </a>{' '}
        en el repositorio.
      </footer>
    </main>
  )
}
