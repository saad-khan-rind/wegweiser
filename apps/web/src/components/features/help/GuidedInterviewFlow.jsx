import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  FileText,
  GraduationCap,
  Languages,
  Lightbulb,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale } from '../../../i18n/useLocale'
import { useGuidedInterview } from '../../../hooks/useGuidedInterview'
import {
  GUIDED_FLOW_RESULT_ID,
  getGuidedAnswerPatch,
  getGuidedNextNode,
  getGuidedNodeOptions,
} from '../../../data/guidedFlow'
import { Button } from '../../ui/Button'

const ICONS = {
  BadgeCheck,
  BriefcaseBusiness,
  FileText,
  GraduationCap,
  Languages,
  Lightbulb,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
}

const TONES = {
  sky: {
    shell: 'border-sky-200 bg-sky-50 text-sky-950',
    accent: 'bg-sky-500',
    active: 'border-sky-200 bg-white shadow-sky-100',
    option: 'hover:border-sky-300 hover:bg-sky-50',
  },
  teal: {
    shell: 'border-teal-200 bg-teal-50 text-teal-950',
    accent: 'bg-teal-500',
    active: 'border-teal-200 bg-white shadow-teal-100',
    option: 'hover:border-teal-300 hover:bg-teal-50',
  },
  indigo: {
    shell: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    accent: 'bg-indigo-500',
    active: 'border-indigo-200 bg-white shadow-indigo-100',
    option: 'hover:border-indigo-300 hover:bg-indigo-50',
  },
  amber: {
    shell: 'border-amber-200 bg-amber-50 text-amber-950',
    accent: 'bg-amber-500',
    active: 'border-amber-200 bg-white shadow-amber-100',
    option: 'hover:border-amber-300 hover:bg-amber-50',
  },
  emerald: {
    shell: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    accent: 'bg-emerald-500',
    active: 'border-emerald-200 bg-white shadow-emerald-100',
    option: 'hover:border-emerald-300 hover:bg-emerald-50',
  },
  coral: {
    shell: 'border-rose-200 bg-rose-50 text-rose-950',
    accent: 'bg-rose-500',
    active: 'border-rose-200 bg-white shadow-rose-100',
    option: 'hover:border-rose-300 hover:bg-rose-50',
  },
  violet: {
    shell: 'border-violet-200 bg-violet-50 text-violet-950',
    accent: 'bg-violet-500',
    active: 'border-violet-200 bg-white shadow-violet-100',
    option: 'hover:border-violet-300 hover:bg-violet-50',
  },
  lime: {
    shell: 'border-lime-200 bg-lime-50 text-lime-950',
    accent: 'bg-lime-500',
    active: 'border-lime-200 bg-white shadow-lime-100',
    option: 'hover:border-lime-300 hover:bg-lime-50',
  },
  result: {
    shell: 'border-slate-200 bg-white text-charcoal',
    accent: 'bg-charcoal',
    active: 'border-slate-200 bg-white shadow-slate-100',
    option: 'hover:border-slate-300 hover:bg-slate-50',
  },
}

function iconFor(name, props = {}) {
  const Icon = ICONS[name] ?? Sparkles
  return <Icon {...props} />
}

function toneFor(tone) {
  return TONES[tone] ?? TONES.sky
}

function selectedClass(selected) {
  return selected
    ? 'border-charcoal bg-charcoal text-white shadow-md'
    : 'border-slate-200 bg-white text-charcoal'
}

function optionLabel(option, t) {
  return option?.label ?? (option?.labelKey ? t(option.labelKey) : String(option?.value ?? ''))
}

function optionHelper(option, t) {
  return option?.helper ?? (option?.helperKey ? t(option.helperKey) : '')
}

function optionBadge(option, t) {
  return option?.badge ?? (option?.badgeKey ? t(option.badgeKey) : '')
}

function optionProviderLabel(provider, t) {
  if (!provider || provider === 'none' || provider === 'local-structure') return ''
  if (provider === 'ai-unavailable') return t('auslander.bubble.aiUnavailable')
  return t('auslander.bubble.aiOptions')
}

function FlowArrow() {
  return (
    <div className="flex w-16 shrink-0 items-center justify-center text-slate-300 sm:w-20">
      <div className="h-px flex-1 bg-slate-200" />
      <ArrowRight size={24} strokeWidth={1.8} aria-hidden="true" />
    </div>
  )
}

function TrailBubble({ item, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 28, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      transition={{ duration: 0.28 }}
      className="relative z-10 flex w-[min(78vw,24rem)] shrink-0"
    >
      <div className="flex min-h-44 w-full flex-col justify-center rounded-[2rem] border border-white/80 bg-white/95 px-6 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.09)] ring-1 ring-slate-200/80">
        <span className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-charcoal text-xs font-black text-white">
          {index + 1}
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {item.question}
        </p>
        <p className="mt-1 text-base font-bold leading-snug text-charcoal">
          {item.answerLabel}
        </p>
      </div>
    </motion.div>
  )
}

function OptionBubble({ option, tone, selected = false, onClick, disabled, t }) {
  const style = toneFor(tone)
  const badge = optionBadge(option, t)
  const helper = optionHelper(option, t)

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-h-24 w-full flex-col justify-center rounded-[999px] border px-6 py-5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal disabled:cursor-not-allowed disabled:opacity-60 ${selectedClass(selected)} ${selected ? '' : style.option}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-bold leading-snug sm:text-base">
          {optionLabel(option, t)}
        </span>
        {selected ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-charcoal">
            <Check size={14} aria-hidden="true" />
          </span>
        ) : option.icon ? (
          <span className="shrink-0 text-slate-400 group-hover:text-charcoal">
            {iconFor(option.icon, { size: 18, 'aria-hidden': true })}
          </span>
        ) : null}
      </span>
      {badge && (
        <span className={`mt-2 w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${selected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
          {badge}
        </span>
      )}
      {helper && (
        <span className={`mt-1.5 text-xs leading-relaxed ${selected ? 'text-white/80' : 'text-slate-500'}`}>
          {helper}
        </span>
      )}
    </button>
  )
}

function ActiveBubble({
  node,
  answers,
  loading,
  options,
  optionsLoading,
  optionMeta,
  onAnswer,
  t,
}) {
  const style = toneFor(node.tone)
  const [numberValue, setNumberValue] = useState('')
  const [selectedValues, setSelectedValues] = useState([])
  const providerLabel = optionProviderLabel(optionMeta?.provider, t)

  useEffect(() => {
    if (node.type === 'number') setNumberValue(answers[node.answerKey] ?? '')
    if (node.type === 'multi') setSelectedValues(answers[node.answerKey] ?? [])
  }, [answers, node.answerKey, node.id, node.type])

  const validNumber = useMemo(() => {
    const parsed = Number(numberValue)
    if (!Number.isFinite(parsed)) return false
    if (node.min !== undefined && parsed < node.min) return false
    if (node.max !== undefined && parsed > node.max) return false
    return true
  }, [node.max, node.min, numberValue])

  const toggleValue = (value) => {
    setSelectedValues((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  return (
    <motion.section
      key={node.id}
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.98 }}
      transition={{ duration: 0.3 }}
      className={`relative z-20 w-[min(86vw,34rem)] shrink-0 rounded-[2.5rem] border p-5 shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:p-6 ${style.active}`}
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <span className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${style.accent} text-white shadow-sm`}>
          <Sparkles size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {t('auslander.bubble.liveNode')}
          </p>
          <h2 className="mt-1 text-balance text-xl font-black leading-tight text-charcoal sm:text-2xl">
            {t(node.questionKey)}
          </h2>
          {node.subtitleKey && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              {t(node.subtitleKey)}
            </p>
          )}
        </div>
      </div>

      {providerLabel && node.type !== 'number' && (
        <p className="mt-4 w-fit rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-500">
          {providerLabel}
        </p>
      )}

      {node.type === 'single' && (
        <div className="mt-6 grid gap-3">
          {optionsLoading && (
            <div className="col-span-full flex min-h-28 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white/70 text-sm font-semibold text-slate-500">
              <Loader2 size={18} className="mr-2 animate-spin" aria-hidden="true" />
              {t('auslander.bubble.loadingOptions')}
            </div>
          )}
          {!optionsLoading && options.length === 0 && (
            <div className="col-span-full rounded-[2rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
              {t('auslander.bubble.noOptions')}
            </div>
          )}
          {options.map((option) => (
            <OptionBubble
              key={option.value}
              option={option}
              tone={node.tone}
              disabled={loading}
              onClick={() => onAnswer(option.value)}
              t={t}
            />
          ))}
        </div>
      )}

      {node.type === 'multi' && (
        <>
          <div className="mt-6 grid max-h-[22rem] gap-3 overflow-y-auto pr-1">
            {optionsLoading && (
              <div className="col-span-full flex min-h-28 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white/70 text-sm font-semibold text-slate-500">
                <Loader2 size={18} className="mr-2 animate-spin" aria-hidden="true" />
                {t('auslander.bubble.loadingOptions')}
              </div>
            )}
            {options.map((option) => (
              <OptionBubble
                key={option.value}
                option={option}
                tone={node.tone}
                selected={selectedValues.includes(option.value)}
                disabled={loading}
                onClick={() => toggleValue(option.value)}
                t={t}
              />
            ))}
            {!optionsLoading && options.length === 0 && (
              <div className="col-span-full rounded-[2rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
                {t('auslander.bubble.noOptions')}
              </div>
            )}
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => setSelectedValues([])}
              disabled={loading || optionsLoading || selectedValues.length === 0}
              className="sm:w-auto"
            >
              {t('auslander.bubble.clearSelection')}
            </Button>
            <Button
              onClick={() => onAnswer(selectedValues)}
              disabled={loading || optionsLoading || (node.requiresAiOptions && options.length === 0)}
              className="flex-1"
            >
              {loading ? t('common.loading') : t('auslander.bubble.continue')}
            </Button>
          </div>
        </>
      )}

      {node.type === 'number' && (
        <form
          className="mt-6 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            if (validNumber) onAnswer(Number(numberValue))
          }}
        >
          <label className="sr-only" htmlFor="guided-age">
            {t(node.questionKey)}
          </label>
          <input
            id="guided-age"
            type="number"
            min={node.min}
            max={node.max}
            inputMode="numeric"
            value={numberValue}
            onChange={(event) => setNumberValue(event.target.value)}
            className="min-h-14 flex-1 rounded-full border border-rose-200 bg-rose-50 px-5 text-lg font-bold text-charcoal outline-none transition focus:border-rose-400 focus:bg-white focus:ring-2 focus:ring-rose-200"
            placeholder={t('auslander.bubble.planningAge.placeholder')}
          />
          <Button
            type="submit"
            disabled={!validNumber || loading}
            className="min-h-14 rounded-full px-7"
          >
            {loading ? t('common.loading') : t('auslander.bubble.continue')}
          </Button>
        </form>
      )}
    </motion.section>
  )
}

function AdviceBubble({ card, index }) {
  const Icon = ICONS[card.icon] ?? Sparkles
  return (
    <motion.article
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className={`relative rounded-[2.5rem] border border-white/80 bg-white/95 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 ${
        index % 2 === 0 ? 'sm:translate-y-2' : 'sm:-translate-y-2'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-civic-purple-light text-civic-purple">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-black leading-tight text-charcoal">{card.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{card.description}</p>
        </div>
      </div>
      {card.content?.steps?.length > 0 && (
        <ol className="mt-4 space-y-2">
          {card.content.steps.slice(0, 4).map((step, stepIndex) => (
            <li key={stepIndex} className="flex gap-2 text-sm text-charcoal">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-charcoal text-[10px] font-bold text-white">
                {stepIndex + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {card.content?.items?.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {card.content.items.slice(0, 6).map((item, itemIndex) => (
            <li
              key={itemIndex}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              {item.text}
            </li>
          ))}
        </ul>
      )}
      {card.content?.sources?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {card.content.sources.slice(0, 4).map((source, sourceIndex) => (
            <a
              key={sourceIndex}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-civic-purple/20 bg-civic-purple-light/50 px-3 py-1 text-xs font-bold text-civic-purple hover:bg-civic-purple-light"
            >
              {source.label}
            </a>
          ))}
        </div>
      )}
    </motion.article>
  )
}

function ResultBubble({ path, advice, loading, onGenerate, t }) {
  return (
    <motion.section
      key="result"
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="relative z-20 mx-auto w-full max-w-5xl"
      aria-live="polite"
    >
      <div className="rounded-[3rem] border border-white/80 bg-white/95 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-charcoal text-white shadow-sm">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              {t('auslander.bubble.ai.badge')}
            </p>
            <h2 className="mt-1 text-xl font-black leading-tight text-charcoal sm:text-2xl">
              {t('auslander.bubble.ai.question')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              {t('auslander.bubble.ai.subtitle')}
            </p>
          </div>
        </div>
        <Button
          onClick={onGenerate}
          disabled={loading}
          className="min-w-44 rounded-full"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
              {t('auslander.bubble.ai.generating')}
            </>
          ) : (
            <>
              <Sparkles size={16} className="mr-2" aria-hidden="true" />
              {advice ? t('auslander.bubble.ai.regenerate') : t('auslander.bubble.ai.generate')}
            </>
          )}
        </Button>
      </div>

      {path.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {path.map((item) => (
            <span
              key={item.id}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600"
            >
              {item.answerLabel}
            </span>
          ))}
        </div>
      )}

      {advice ? (
        <div className="mt-6">
          {advice.intro && (
            <p className="mb-4 text-sm font-semibold text-charcoal">{advice.intro}</p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {(advice.cards ?? []).map((card, index) => (
              <AdviceBubble key={card.id ?? index} card={card} index={index} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[999px] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-5">
          <p className="text-sm leading-relaxed text-slate-500">
            {t('auslander.bubble.ai.empty')}
          </p>
        </div>
      )}
      </div>
    </motion.section>
  )
}

export function GuidedInterviewFlow() {
  const { t } = useLocale()
  const {
    answers,
    activeBubble,
    bubblePath,
    guidedAdvice,
    saveBubbleAnswer,
    goBackBubble,
    resetBubbleFlow,
    goToChooseMode,
    generateGuidedAdvice,
    fetchBubbleOptions,
    loading,
  } = useGuidedInterview()
  const panelRef = useRef(null)
  const railRef = useRef(null)
  const [dynamicOptions, setDynamicOptions] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionMeta, setOptionMeta] = useState(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [activeBubble?.id])

  const isResult = activeBubble?.id === GUIDED_FLOW_RESULT_ID || activeBubble?.type === 'result'

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    requestAnimationFrame(() => {
      rail.scrollTo({ left: rail.scrollWidth, behavior: 'smooth' })
    })
  }, [activeBubble?.id, bubblePath.length, isResult])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      if (!activeBubble || activeBubble.type === 'number' || activeBubble.type === 'result') {
        setDynamicOptions([])
        setOptionMeta(null)
        return
      }
      if (!activeBubble.requiresAiOptions) {
        setDynamicOptions(getGuidedNodeOptions(activeBubble, answers))
        setOptionMeta({ provider: 'local-structure' })
        setOptionsLoading(false)
        return
      }
      setOptionsLoading(true)
      try {
        const payload = await fetchBubbleOptions(activeBubble.id)
        if (cancelled) return
        setDynamicOptions(getGuidedNodeOptions(activeBubble, answers, payload?.options ?? []))
        setOptionMeta(payload ?? null)
      } catch {
        if (!cancelled) {
          setDynamicOptions(activeBubble.requiresAiOptions ? [] : getGuidedNodeOptions(activeBubble, answers))
          setOptionMeta({ provider: activeBubble.requiresAiOptions ? 'ai-unavailable' : 'local-structure' })
        }
      } finally {
        if (!cancelled) setOptionsLoading(false)
      }
    }
    loadOptions()
    return () => {
      cancelled = true
    }
  }, [activeBubble, answers, bubblePath, fetchBubbleOptions])

  const formatAnswerLabel = (node, value) => {
    if (node.type === 'number') {
      return t('auslander.bubble.ageValue', { age: value })
    }
    if (node.type === 'multi') {
      const options = getGuidedNodeOptions(node, answers, dynamicOptions)
      const labels = (value ?? [])
        .map((item) => {
          const option = options.find((candidate) => candidate.value === item)
          return option ? optionLabel(option, t) : item
        })
        .filter(Boolean)
      return labels.length ? labels.join(', ') : t('auslander.bubble.documents.none')
    }
    const option = getGuidedNodeOptions(node, answers, dynamicOptions).find((item) => item.value === value)
    return option ? optionLabel(option, t) : String(value)
  }

  const handleAnswer = async (value) => {
    const allowedOptions = getGuidedNodeOptions(activeBubble, answers, dynamicOptions)
    if (activeBubble.type !== 'number' && activeBubble.type !== 'multi') {
      const selected = allowedOptions.find((option) => option.value === value)
      if (!selected) return
    }
    const patch = getGuidedAnswerPatch(activeBubble, value, answers, allowedOptions)
    const nextAnswers = { ...answers, ...patch }
    const nextNodeId = getGuidedNextNode(activeBubble, value, nextAnswers, allowedOptions)
    await saveBubbleAnswer({
      nodeId: activeBubble.id,
      nextNodeId,
      answerKey: activeBubble.answerKey,
      value,
      answerLabel: formatAnswerLabel(activeBubble, value),
      question: t(activeBubble.questionKey),
      patch,
    })
  }

  const handleBack = async () => {
    if (bubblePath.length === 0 && !isResult) {
      await goToChooseMode()
      return
    }
    await goBackBubble()
  }

  return (
    <div className="w-full max-w-none">
      <div className="mb-5 flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goToChooseMode}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal"
            aria-label={t('help.backToChoose')}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black text-charcoal sm:text-2xl">
              {t('help.guided.flowTitle')}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {t('auslander.bubble.flowSubtitle')}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={loading}
            className="rounded-full px-4"
          >
            {t('intake.back')}
          </Button>
          <Button
            variant="secondary"
            onClick={resetBubbleFlow}
            disabled={loading}
            className="rounded-full px-4"
          >
            <RotateCcw size={16} className="mr-2" aria-hidden="true" />
            {t('auslander.bubble.reset')}
          </Button>
        </div>
      </div>

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative min-h-[72vh] overflow-hidden bg-[#f7faf9] py-5 outline-none ring-1 ring-slate-200 sm:py-7"
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200/70" />
        <div
          ref={railRef}
          className="relative overflow-x-auto overscroll-x-contain px-4 pb-4 pt-2 sm:px-8"
        >
          <div className="flex min-w-max items-center py-8">
            <AnimatePresence initial={false}>
              {bubblePath.map((item, index) => (
                <div key={item.id} className="flex items-center">
                  <TrailBubble item={item} index={index} />
                  {(index < bubblePath.length - 1 || !isResult) && <FlowArrow />}
                </div>
              ))}
            </AnimatePresence>

            {!isResult && (
              <ActiveBubble
                node={activeBubble}
                answers={answers}
                loading={loading}
                options={dynamicOptions}
                optionsLoading={optionsLoading}
                optionMeta={optionMeta}
                onAnswer={handleAnswer}
                t={t}
              />
            )}
          </div>
        </div>

        {isResult && (
          <div className="relative px-4 pb-6 sm:px-8">
            <ResultBubble
              path={bubblePath}
              advice={guidedAdvice}
              loading={loading}
              onGenerate={generateGuidedAdvice}
              t={t}
            />
          </div>
        )}
      </div>
    </div>
  )
}
