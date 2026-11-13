import Link from "next/link";
import { IconArrow, IconCheck, IconEye, IconEyeOff, IconLock, IconMoto, IconPlus, IconReturn, IconShield, IconSpark } from "@/components/icons";
import { LanguageSwitch } from "@/components/i18n";
import { Ticket } from "@/components/landing/Ticket";
import { Qr } from "@/components/Qr";
import { buttonClass, Logo, Stamp, Stars } from "@/components/ui";
import { xof } from "@/lib/format";
import { getDict } from "@/lib/locale";

export default async function LandingPage() {
  const { t } = await getDict();
  const L = t.landing;
  const total = L.ticket.price + L.ticket.delivery;
  const ticketLabels = { item: t.common.item, delivery: t.common.delivery, total: t.common.total };

  return (
    <div className="overflow-x-clip">
      {/* ---- Navigation ---------------------------------------------------------------------- */}
      <header className="wrap flex items-center justify-between gap-4 py-5">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
          {[
            ["#how", t.nav.how],
            ["#security", t.nav.security],
            ["#faq", t.nav.faq],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full px-4 py-2 text-[0.95rem] font-medium text-ink-soft hover:bg-sand hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <LanguageSwitch className="hidden sm:block" />
          <Link href="/login" className="rounded-full px-3 py-2 text-[0.95rem] font-semibold hover:bg-sand sm:px-4">
            {t.nav.login}
          </Link>
          <Link href="/start" className={buttonClass("primary", "sm", "hidden sm:inline-flex")}>
            {t.nav.start}
          </Link>
        </div>
      </header>

      <main>
        {/* ---- Hero -------------------------------------------------------------------------- */}
        <section className="wrap pt-6 pb-16 lg:pt-10 lg:pb-24">
          <div className="overflow-hidden rounded-[2.5rem] border border-line bg-card shadow-block">
            <div className="grid items-center gap-10 px-5 py-6 sm:px-8 lg:grid-cols-[1.12fr_0.88fr] lg:px-10 lg:py-10">
              <div className="animate-rise">
                <p className="eyebrow inline-flex items-center gap-2 rounded-full border-2 border-ink bg-butter px-3.5 py-1.5">
                  <span className="size-2 rounded-full bg-clay" />
                  {L.eyebrow}
                </p>
                <h1 className="mt-6 max-w-[16ch] text-[clamp(3rem,6.8vw,6.1rem)] leading-[0.94] tracking-[-0.06em] text-ink">
                  {L.title1}
                  <span className="italic-serif mt-2 block text-clay">{L.title2}</span>
                </h1>
                <p className="mt-7 max-w-[36rem] text-[1.06rem] leading-relaxed text-ink-soft sm:text-xl">{L.sub}</p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link href="/start" className={buttonClass("primary", "lg")}>
                    {L.cta}
                    <IconArrow />
                  </Link>
                  <a href="#how" className={buttonClass("ghost", "lg")}>
                    {L.cta2}
                  </a>
                </div>
                <div className="mt-7 flex flex-wrap items-center gap-3 text-sm font-semibold text-ink-soft">
                  <span className="rounded-full border-2 border-ink bg-sand px-3 py-1.5">No pooled funds</span>
                  <span className="rounded-full border-2 border-ink bg-sky px-3 py-1.5">Buyer release</span>
                  <span className="rounded-full border-2 border-ink bg-mint px-3 py-1.5">Refund by default</span>
                </div>
              </div>

              <div className="relative mx-auto w-full max-w-[30rem] lg:max-w-none" aria-hidden="true">
                <div className="relative aspect-[5/6] overflow-hidden rounded-[2.75rem] border-2 border-ink bg-sand sm:aspect-square lg:aspect-[5/6]">
                  <div className="absolute -right-16 -top-16 size-64 rounded-full border border-indigo/10 bg-mint/70" />
                  <div className="absolute -bottom-20 -left-16 size-56 rounded-full border border-indigo/10 bg-butter/70" />
                  <div className="absolute inset-x-5 top-5 rounded-[1.5rem] border-2 border-ink bg-card/90 p-3 shadow-block-sm backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">Live order</span>
                      <span className="rounded-full bg-mint px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-leaf">locked</span>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="size-10 rounded-2xl bg-sand border-2 border-ink" />
                      <div className="flex-1">
                        <p className="text-[0.82rem] font-semibold text-ink-soft">Atelier Ndeye</p>
                        <p className="text-sm font-semibold">Bazin boubou · 35,000 F</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ ["--bob-rotate" as string]: "-4deg" }} className="absolute top-[9%] left-[4%] w-[72%] animate-bob drop-shadow-[8px_10px_0_#211b14]">
                  <Ticket shop={L.ticket.shop} title={L.ticket.item} note={L.ticket.itemNote} amount={L.ticket.price} delivery={L.ticket.delivery} labels={ticketLabels} />
                  <Stamp animate rotate={-9} className="absolute top-[40%] right-3 bg-card/90 [animation-delay:0.7s]">
                    {L.ticket.stamp}
                  </Stamp>
                </div>

                <div style={{ ["--bob-rotate" as string]: "5deg", animationDelay: "-2.5s" }} className="absolute right-[1%] bottom-[3%] w-[42%] animate-bob rounded-[1.5rem] border-2 border-ink bg-card p-3 shadow-block">
                  <Qr value={`https://jotna.app/r/k7qm2xpa4n8w3d#${"K7QM2XPA9RTD4WVB"}`} size={180} label="" />
                  <p className="mt-2 text-center text-[0.68rem] font-semibold tracking-[0.14em] text-ink-soft uppercase">{L.ticket.qrLabel}</p>
                </div>

                <div className="absolute -top-3 right-[8%] flex items-center gap-2 rounded-full border-2 border-ink bg-mint px-4 py-2 text-sm font-semibold text-leaf shadow-block-sm">
                  <IconMoto width={18} height={18} />
                  {L.ticket.rider}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Three facts ------------------------------------------------------------------- */}
        <section className="wrap pb-16 lg:pb-24">
          <dl className="grid gap-4 sm:grid-cols-3">
            {L.facts.map((f, i) => (
              <div key={f.k} className={`rounded-[1.75rem] border-2 border-ink bg-card p-5 shadow-block-sm ${i === 1 ? "bg-sky" : i === 2 ? "bg-mint" : "bg-sand"}`}>
                <dt className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{f.k}</dt>
                <dd className="mt-2 max-w-[18rem] text-[1.02rem] leading-relaxed text-ink-soft">{f.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ---- Neighbourhood ribbon ---------------------------------------------------------- */}
        <div className="border-y border-indigo-deep bg-indigo-deep py-3.5 text-card" aria-hidden="true">
          <div className="flex w-max animate-marquee gap-8 whitespace-nowrap">
            {[...L.marquee, ...L.marquee, ...L.marquee, ...L.marquee].map((place, i) => (
              <span key={i} className="flex items-center gap-8 font-display text-xl font-medium italic">
                {place}
                <span className="size-2 rotate-45 bg-sun" />
              </span>
            ))}
          </div>
        </div>

        {/* ---- Problem ----------------------------------------------------------------------- */}
        <section className="wrap py-20 lg:py-28">
          <p className="eyebrow text-clay">{L.problem.eyebrow}</p>
          <h2 className="mt-4 max-w-[18ch] text-[clamp(2.2rem,5.4vw,4.2rem)] font-semibold">{L.problem.title}</h2>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {L.problem.voices.map((v, i) => {
              const tone = ["bg-sky", "bg-blush", "bg-butter"][i];
              return (
                <figure key={v.who} className="flex flex-col">
                  <blockquote className={`relative flex-1 rounded-[1.75rem] border-2 border-ink ${tone} p-6 pb-7`}>
                    <p className="font-display text-[1.6rem] leading-[1.15] font-medium">«&nbsp;{v.quote}&nbsp;»</p>
                    <span className={`absolute -bottom-[11px] left-9 size-5 rotate-45 border-r-2 border-b-2 border-ink ${tone}`} />
                  </blockquote>
                  <figcaption className="mt-5 pl-2">
                    <span className="eyebrow">{v.who}</span>
                    <span className="mt-1 block text-ink-soft">{v.then}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>

          <div className="mt-14 flex flex-col gap-4 rounded-[1.75rem] border-2 border-dashed border-ink/40 p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
            <p className="font-display text-6xl leading-none font-semibold whitespace-nowrap text-clay sm:text-7xl">{L.problem.stat}</p>
            <div>
              <p className="max-w-[36rem] text-lg font-medium">{L.problem.statText}</p>
              <p className="mt-1 text-sm text-ink-faint">{L.problem.statNote}</p>
            </div>
          </div>
        </section>

        {/* ---- How it works ------------------------------------------------------------------ */}
        <section id="how" className="scroll-mt-6 bg-card py-20 lg:py-28">
          <div className="wrap">
            <p className="eyebrow text-indigo">{L.how.eyebrow}</p>
            <h2 className="mt-4 max-w-[20ch] text-[clamp(2.2rem,5.4vw,4.2rem)] font-semibold">{L.how.title}</h2>

            <ol className="mt-14 grid gap-6 md:grid-cols-2">
              {L.how.steps.map((s, i) => (
                <li key={s.t} className="group flex flex-col overflow-hidden rounded-[2rem] border-2 border-ink bg-paper">
                  <div className={`relative flex h-52 items-center justify-center overflow-hidden border-b-2 border-ink px-6 ${["bg-sky", "bg-butter", "bg-mint", "bg-blush"][i]}`}>
                    <StepArt index={i} mock={L.how.mock} total={xof(total)} />
                  </div>
                  <div className="flex gap-5 p-6 sm:p-7">
                    <span className="font-display text-6xl leading-[0.8] font-semibold text-transparent [-webkit-text-stroke:2px_#211b14]">{i + 1}</span>
                    <div>
                      <h3 className="text-2xl font-semibold">{s.t}</h3>
                      <p className="mt-2 text-ink-soft">{s.d}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex flex-col gap-4 rounded-[2rem] border-2 border-ink bg-sand p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-7">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-card">
                <IconReturn width={26} height={26} />
              </span>
              <p className="text-lg">
                <strong className="font-display text-xl font-semibold">{L.how.else}</strong> <span className="text-ink-soft">{L.how.elseText}</span>
              </p>
            </div>
          </div>
        </section>

        {/* ---- Roles ------------------------------------------------------------------------- */}
        <section className="wrap py-20 lg:py-28">
          <p className="eyebrow text-leaf">{L.roles.eyebrow}</p>
          <h2 className="mt-4 max-w-[22ch] text-[clamp(2.2rem,5.4vw,4.2rem)] font-semibold">{L.roles.title}</h2>
          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {L.roles.items.map((r, i) => (
              <article key={r.who} className="relative rounded-[2rem] border-2 border-ink bg-card p-7 pt-10 shadow-block">
                <span className={`eyebrow absolute -top-4 left-6 rounded-full border-2 border-ink px-4 py-1.5 ${["bg-sun", "bg-sky", "bg-mint"][i]}`}>{r.who}</span>
                <h3 className="text-[1.75rem] font-semibold">{r.t}</h3>
                <ul className="mt-5 space-y-3.5">
                  {r.points.map((p) => (
                    <li key={p} className="flex gap-3 text-[1.02rem]">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-card">
                        <IconCheck width={14} height={14} strokeWidth={3} />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ---- Security ---------------------------------------------------------------------- */}
        <section id="security" className="scroll-mt-6 border-y border-line bg-sky py-20 lg:py-28">
          <div className="wrap">
            <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
              <div>
                <p className="eyebrow flex items-center gap-2 text-indigo">
                  <IconShield width={18} height={18} />
                  {L.security.eyebrow}
                </p>
                <h2 className="mt-4 text-[clamp(2.2rem,5.4vw,4.2rem)] font-semibold text-indigo-deep">{L.security.title}</h2>
                <p className="mt-5 font-display text-2xl text-indigo italic">{L.security.sub}</p>

                {/* Where the money goes, and where Jotna sits. */}
                <div className="mt-10 rounded-[2rem] border-2 border-ink bg-card p-5 sm:p-7">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
                    <div className="rounded-2xl border-2 border-ink bg-paper px-3 py-4 text-center text-sm font-semibold sm:text-base">{L.security.diagram.buyer}</div>
                    <div className="flex flex-col items-center gap-1 text-indigo">
                      <span className="flex size-11 items-center justify-center rounded-full border-2 border-ink bg-sun text-ink">
                        <IconLock width={20} height={20} />
                      </span>
                      <span className="hidden text-[0.7rem] font-semibold tracking-wide uppercase sm:block">{L.security.diagram.lock}</span>
                    </div>
                    <div className="rounded-2xl border-2 border-ink bg-paper px-3 py-4 text-center text-sm font-semibold sm:text-base">{L.security.diagram.seller}</div>
                  </div>
                  <div className="mx-auto h-8 w-0 border-l-2 border-dashed border-ink/50" />
                  <div className="rounded-2xl border-2 border-dashed border-ink/50 p-4">
                    <p className="text-center font-display text-xl font-semibold">Jotna</p>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <p className="flex gap-2">
                        <IconEye width={18} height={18} className="mt-0.5 shrink-0 text-leaf" />
                        <span>
                          <strong className="block">{L.security.diagram.sees}</strong>
                          <span className="text-ink-soft">{L.security.diagram.seesText}</span>
                        </span>
                      </p>
                      <p className="flex gap-2">
                        <IconEyeOff width={18} height={18} className="mt-0.5 shrink-0 text-clay" />
                        <span>
                          <strong className="block">{L.security.diagram.never}</strong>
                          <span className="text-ink-soft">{L.security.diagram.neverText}</span>
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <ul className="grid content-start gap-5 sm:grid-cols-2 lg:pt-14">
                {L.security.points.map((p, i) => (
                  <li key={p.t} className="rounded-[1.75rem] border-2 border-ink bg-card p-6">
                    <span className="font-display text-lg font-semibold text-indigo">0{i + 1}</span>
                    <h3 className="mt-2 text-[1.4rem] font-semibold">{p.t}</h3>
                    <p className="mt-2.5 text-ink-soft">{p.d}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---- Reputation and assistant ------------------------------------------------------ */}
        <section className="wrap grid gap-6 py-20 lg:grid-cols-2 lg:py-28">
          <article className="flex flex-col rounded-[2.25rem] border-2 border-ink bg-mint p-7 sm:p-10">
            <p className="eyebrow text-leaf">{L.reputation.eyebrow}</p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,3rem)] font-semibold">{L.reputation.title}</h2>
            <p className="mt-4 text-[1.05rem] text-ink-soft">{L.reputation.body}</p>
            <div className="mt-8 rounded-3xl border-2 border-ink bg-card p-5 shadow-block" aria-hidden="true">
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-xl font-semibold">{L.ticket.shop}</span>
                <Stars value={5} />
              </div>
              <div className="dash-rule my-4" />
              <div className="grid grid-cols-2 gap-4">
                <p>
                  <span className="tabular block font-display text-4xl font-semibold">128</span>
                  <span className="text-sm text-ink-soft">{L.reputation.card.delivered}</span>
                </p>
                <p>
                  <span className="tabular block font-display text-4xl font-semibold">4,9</span>
                  <span className="text-sm text-ink-soft">{L.reputation.card.rating}</span>
                </p>
              </div>
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-leaf">
                <IconCheck width={16} height={16} strokeWidth={3} />
                {L.reputation.card.verify}
              </p>
            </div>
          </article>

          <article className="flex flex-col rounded-[2.25rem] border-2 border-ink bg-butter p-7 sm:p-10">
            <p className="eyebrow flex items-center gap-2 text-clay-deep">
              <IconSpark width={18} height={18} />
              {L.ai.eyebrow}
            </p>
            <h2 className="mt-4 text-[clamp(2rem,4vw,3rem)] font-semibold">{L.ai.title}</h2>
            <p className="mt-4 text-[1.05rem] text-ink-soft">{L.ai.body}</p>
            <div className="mt-8 space-y-3" aria-hidden="true">
              <div className="rounded-3xl rounded-bl-md border-2 border-ink bg-card px-5 py-4">
                <span className="eyebrow text-ink-faint">{L.ai.label}</span>
                <p className="mt-1 font-mono text-[0.95rem]">{L.ai.input}</p>
              </div>
              <div className="flex justify-center text-ink">
                <IconArrow className="rotate-90" />
              </div>
              <div className="rounded-3xl border-2 border-ink bg-card p-5 shadow-block">
                <span className="eyebrow text-leaf">{L.ai.result}</span>
                <p className="mt-1.5 font-display text-2xl font-semibold">{L.ai.outTitle}</p>
                <p className="text-ink-soft">{L.ai.outDesc}</p>
                <div className="tabular mt-3 flex gap-6 text-sm">
                  <span>
                    <span className="text-ink-soft">{t.common.item}</span> <strong>{L.ai.outPrice}</strong>
                  </span>
                  <span>
                    <span className="text-ink-soft">{t.common.delivery}</span> <strong>{L.ai.outDelivery}</strong>
                  </span>
                </div>
              </div>
            </div>
          </article>
        </section>

        {/* ---- Questions --------------------------------------------------------------------- */}
        <section id="faq" className="scroll-mt-6 bg-card py-20 lg:py-28">
          <div className="wrap grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <p className="eyebrow text-clay">{L.faq.eyebrow}</p>
              <h2 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-semibold">{L.faq.title}</h2>
            </div>
            <div className="border-t-2 border-ink">
              {L.faq.items.map((item) => (
                <details key={item.q} className="group border-b-2 border-ink">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 font-display text-[1.35rem] leading-snug font-medium [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink transition-transform duration-200 group-open:rotate-45 group-open:bg-sun">
                      <IconPlus width={18} height={18} />
                    </span>
                  </summary>
                  <p className="max-w-[40rem] pb-6 text-[1.05rem] text-ink-soft">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Final call -------------------------------------------------------------------- */}
        <section className="wrap py-16 lg:py-24">
          <div className="relative overflow-hidden rounded-[2.75rem] border border-indigo-deep bg-indigo-deep text-card shadow-block">
            <div className="absolute -right-20 -bottom-36 size-80 rounded-full border border-white/15" aria-hidden="true">
              <div className="absolute inset-8 rounded-full border border-white/15" />
            </div>
            <div className="relative p-8 sm:p-14 md:w-3/4">
              <h2 className="max-w-[16ch] text-[clamp(2.4rem,6vw,4.6rem)] font-semibold">{L.final.title}</h2>
              <p className="mt-5 max-w-[32rem] text-lg text-card/90">{L.final.sub}</p>
              <Link href="/start" className={buttonClass("secondary", "lg", "mt-9")}>
                {L.final.cta}
                <IconArrow />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="wrap flex flex-col gap-6 border-t-2 border-ink py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 text-sm text-ink-soft">{L.footer.line}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.95rem] font-medium" aria-label="Footer">
          <a href="#how" className="hover:underline">{L.footer.links.how}</a>
          <a href="#security" className="hover:underline">{L.footer.links.security}</a>
          <a href="#faq" className="hover:underline">{L.footer.links.faq}</a>
          <Link href="/login" className="hover:underline">{L.footer.links.login}</Link>
          <LanguageSwitch className="-ml-3" />
        </nav>
      </footer>
    </div>
  );
}

/** Small scenes that show each step with the product's own interface, not stock illustration. */
function StepArt({ index, mock, total }: { index: number; mock: Record<string, string>; total: string }) {
  if (index === 0) {
    return (
      <div className="w-full max-w-[19rem] space-y-2 text-[0.9rem]">
        <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-md border-2 border-ink bg-card px-3.5 py-2">{mock.chat1}</p>
        <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md border-2 border-ink bg-mint px-3.5 py-2">
          <p>{mock.chat2}</p>
          <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-card px-2 py-1 font-mono text-[0.78rem] font-semibold text-indigo underline">{mock.link}</p>
        </div>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="relative rounded-3xl border-2 border-ink bg-card px-7 py-5 text-center shadow-block transition-transform duration-300 group-hover:-rotate-2">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full border-2 border-ink bg-sun">
          <IconLock />
        </span>
        <p className="tabular mt-3 font-display text-3xl font-semibold">{mock.lock}</p>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="w-full max-w-[20rem]">
        <p className="flex items-center gap-2 rounded-full border-2 border-ink bg-card px-4 py-2.5 text-[0.95rem] font-semibold shadow-block-sm">
          <span className="flex size-6 items-center justify-center rounded-full bg-leaf text-card">
            <IconCheck width={14} height={14} strokeWidth={3} />
          </span>
          {mock.go}
        </p>
        <div className="relative mt-6 h-10">
          <div className="absolute inset-x-0 bottom-1 border-b-2 border-dashed border-ink/50" />
          <IconMoto width={44} height={44} className="absolute bottom-0 left-[8%] transition-transform duration-700 ease-out group-hover:translate-x-[9rem]" />
          <span className="absolute right-0 bottom-0 h-8 w-6 rounded-t-full border-2 border-ink bg-indigo" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <div className="rounded-2xl border-2 border-ink bg-card p-2 shadow-block-sm">
        <Qr value="https://jotna.app/r/k7qm2xpa4n8w3d#K7QM2XPA9RTD4WVB" size={104} label="" />
      </div>
      <IconArrow width={28} height={28} />
      <div className="text-center">
        <Stamp tone="leaf" rotate={-6} className="bg-card text-lg">
          {mock.paid.split(" · ")[0]}
        </Stamp>
        <p className="tabular mt-3 font-display text-xl font-semibold">{total}</p>
      </div>
    </div>
  );
}
