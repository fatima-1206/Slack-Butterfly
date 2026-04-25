import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_12%_20%,#ffd9f6_0%,transparent_32%),radial-gradient(circle_at_85%_82%,#ebc4ff_0%,transparent_36%),linear-gradient(135deg,#fff9fe_0%,#f6f8ff_100%)] text-zinc-900">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <Image
            src="/icons8-butterfly-pieces-96.png"
            alt="Slack Butterfly icon"
            width={40}
            height={40}
            priority
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700">Slack Butterfly</p>
            <p className="text-sm text-zinc-600">People-matching co-pilot</p>
          </div>
        </div>
        <a
          className="rounded-full border border-fuchsia-300/70 bg-white/70 px-4 py-2 text-sm font-medium text-fuchsia-900 backdrop-blur transition hover:border-fuchsia-500 hover:bg-white"
          href="/api/slack/events"
        >
          API Endpoint
        </a>
        <a
          className="rounded-full bg-fuchsia-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-800"
          href="/api/slack/oauth/start"
        >
          Add To Slack
        </a>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-6 pb-12 pt-4 md:grid-cols-[1.1fr_0.9fr] md:px-10 md:pb-16">
        <section className="rounded-3xl border border-fuchsia-200/70 bg-white/80 p-8 shadow-[0_24px_70px_-45px_rgba(136,19,148,0.6)] backdrop-blur-sm md:p-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-fuchsia-900">
            <Image src="/icons8-butterfly-pieces-16.png" alt="Butterfly mini icon" width={16} height={16} />
            Slack Collaboration Agent
          </div>

          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-zinc-950 md:text-5xl">
            Turn vague asks into precise recommendations of who to contact next.
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-700 md:text-lg">
            Slack Butterfly runs inside DMs, gathers context with clarifying questions, and ranks the most relevant people in your workspace with rationale and suggested outreach prompts.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Conversation Quality</p>
              <p className="mt-1 text-sm text-zinc-700">Guided clarification until required problem fields are complete.</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reasoned Matching</p>
              <p className="mt-1 text-sm text-zinc-700">LLM ranking blended with heuristics and confidence-aware fallbacks.</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Stateful Memory</p>
              <p className="mt-1 text-sm text-zinc-700">Conversation state is persisted so follow-up refinement works naturally.</p>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Actionable Output</p>
              <p className="mt-1 text-sm text-zinc-700">Every recommendation includes score, relevance, and a concrete ask.</p>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-3xl border border-fuchsia-200/70 bg-white/80 p-6 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-3">
              <Image src="/icons8-butterfly-pieces-32.png" alt="Butterfly icon" width={32} height={32} />
              <h2 className="text-lg font-semibold text-zinc-900">How It Works</h2>
            </div>
            <ol className="space-y-3 text-sm text-zinc-700">
              <li><span className="font-semibold text-zinc-900">1.</span> Capture challenge context in DM.</li>
              <li><span className="font-semibold text-zinc-900">2.</span> Build structured problem state with confidence.</li>
              <li><span className="font-semibold text-zinc-900">3.</span> Filter and enrich workspace contacts.</li>
              <li><span className="font-semibold text-zinc-900">4.</span> Rank + explain who to reach out to next.</li>
            </ol>
          </div>

          <div className="rounded-3xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50 to-purple-50 p-6">
            <h3 className="text-lg font-semibold text-zinc-900">Built-In Commands</h3>
            <p className="mt-2 text-sm text-zinc-700">Use quick controls in Slack to inspect the agent state or reset context.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700">status</span>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700">help</span>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700">reset</span>
            </div>
            <Image
              className="mt-6"
              src="/icons8-butterfly-pieces-512.png"
              alt="Butterfly brand mark"
              width={112}
              height={112}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
