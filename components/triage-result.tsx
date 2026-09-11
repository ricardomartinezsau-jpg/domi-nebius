import type { TriageOutput } from '@/lib/triage'

const TRAYS = [
  ['personalBienestar', 'Personal / Bienestar'],
  ['profesionalProductiva', 'Profesional / Negocio'],
  ['familiarDomestica', 'Familiar / Doméstica'],
  ['socialComunitaria', 'Social / Comunitaria'],
] as const

export function TriageResult({ output }: { output: TriageOutput }) {
  return (
    <div className="result">
      <section className="card">
        <h2>Modo momentum</h2>
        <p className="hook">{output.momentumMode.activationHook}</p>
        <p className="trap">
          <strong>Escudo de foco: </strong>
          {output.momentumMode.singleFocusShield}
        </p>
        {output.momentumMode.antiDopamineTraps.map((trap, i) => (
          <p className="trap" key={i}>
            <strong>Trampa detectada — {trap.activity}: </strong>
            {trap.warning}
          </p>
        ))}
      </section>

      <section className="card">
        <h2>4 bandejas de vida</h2>
        <div className="trays">
          {TRAYS.map(([key, label]) => (
            <div className="tray" key={key}>
              <h3>
                {label} ({output.trayDispatch[key].length})
              </h3>
              {output.trayDispatch[key].length ? (
                <ul>
                  {output.trayDispatch[key].map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Sin ítems.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Orden de dependencias</h2>
        <ol className="deps">
          {output.dependencyOrder.map((step) => (
            <li key={step.step}>
              {step.task}
              <div className="why">{step.whyThisOrder}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Micro-tareas</h2>
        {output.microTasks.map((group, i) => (
          <div className="micro-group" key={i}>
            <h4>{group.originalTask}</h4>
            {group.atomicSteps.map((step, j) => (
              <div className="micro-step" key={j}>
                <span className="mins">{step.durationMinutes} min</span> — {step.stepTitle}
                <div className="why">{step.actionableHook}</div>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}
