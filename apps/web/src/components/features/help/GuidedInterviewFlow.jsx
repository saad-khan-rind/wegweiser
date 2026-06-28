import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
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
import { ActionCardGrid } from './assistant/ActionCardGrid'

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

function pathSide(index) {
  return index % 2 === 0 ? 'justify-start pr-6 sm:pr-20' : 'justify-end pl-6 sm:pl-20'
}

function selectedClass(selected) {
  return selected
    ? 'border-charcoal bg-charcoal text-white shadow-md'
    : 'border-slate-200 bg-white text-charcoal'
}

function TrailBubble({ item, index }) {
  const side = pathSide(index)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28 }}
      className={`relative z-10 flex ${side}`}
    >
      <div className="max-w-[min(100%,28rem)] rounded-[2rem] border border-white/80 bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/80">
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

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex min-h-24 w-full flex-col justify-center rounded-[1.75rem] border px-4 py-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal disabled:cursor-not-allowed disabled:opacity-60 ${selectedClass(selected)} ${selected ? '' : style.option}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-bold leading-snug sm:text-base">
          {t(option.labelKey)}
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
      {option.badgeKey && (
        <span className={`mt-2 w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${selected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
          {t(option.badgeKey)}
        </span>
      )}
      {option.helperKey && (
        <span className={`mt-1.5 text-xs leading-relaxed ${selected ? 'text-white/80' : 'text-slate-500'}`}>
          {t(option.helperKey)}
        </span>
      )}
    </button>
  )
}

function ActiveBubble({
  node,
  answers,
  loading,
  onAnswer,
  t,
}) {
  const style = toneFor(node.tone)
  const options = getGuidedNodeOptions(node, answers)
  const [numberValue, setNumberValue] = useState('')
  const [selectedValues, setSelectedValues] = useState([])

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
      className={`relative z-20 mx-auto w-full max-w-3xl rounded-[2.25rem] border p-5 shadow-xl sm:p-6 ${style.active}`}
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

      {node.type === 'single' && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
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
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
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
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => setSelectedValues([])}
              disabled={loading || selectedValues.length === 0}
              className="sm:w-auto"
            >
              {t('auslander.bubble.clearSelection')}
            </Button>
            <Button
              onClick={() => onAnswer(selectedValues)}
              disabled={loading}
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

function ResultBubble({ path, advice, loading, onGenerate, t }) {
  return (
    <motion.section
      key="result"
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="relative z-20 mx-auto w-full max-w-4xl rounded-[2.25rem] border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
      aria-live="polite"
    >
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
          <ActionCardGrid cards={advice.cards ?? []} />
        </div>
      ) : (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-5">
          <p className="text-sm leading-relaxed text-slate-500">
            {t('auslander.bubble.ai.empty')}
          </p>
        </div>
      )}
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
    loading,
  } = useGuidedInterview()
  const panelRef = useRef(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [activeBubble?.id])

  const isResult = activeBubble?.id === GUIDED_FLOW_RESULT_ID || activeBubble?.type === 'result'

  const formatAnswerLabel = (node, value) => {
    if (node.type === 'number') {
      return t('auslander.bubble.ageValue', { age: value })
    }
    if (node.type === 'multi') {
      const options = getGuidedNodeOptions(node, answers)
      const labels = (value ?? [])
        .map((item) => options.find((option) => option.value === item)?.labelKey)
        .filter(Boolean)
        .map((key) => t(key))
      return labels.length ? labels.join(', ') : t('auslander.bubble.documents.none')
    }
    const option = getGuidedNodeOptions(node, answers).find((item) => item.value === value)
    return option?.labelKey ? t(option.labelKey) : String(value)
  }

  const handleAnswer = async (value) => {
    const patch = getGuidedAnswerPatch(activeBubble, value, answers)
    const nextAnswers = { ...answers, ...patch }
    const nextNodeId = getGuidedNextNode(activeBubble, value, nextAnswers)
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
    <div className="mx-auto w-full max-w-6xl px-1 sm:px-2">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,#dbeafe_0,#f8fafc_34%,#ecfdf5_72%,#fff7ed_100%)] px-4 py-6 outline-none sm:px-6 sm:py-8"
      >
        <div className="pointer-events-none absolute left-1/2 top-8 h-[calc(100%-4rem)] w-px -translate-x-1/2 bg-gradient-to-b from-sky-200 via-emerald-200 to-amber-200" />
        <div className="relative space-y-5 sm:space-y-6">
          <AnimatePresence initial={false}>
            {bubblePath.map((item, index) => (
              <TrailBubble key={item.id} item={item} index={index} />
            ))}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {isResult ? (
              <ResultBubble
                path={bubblePath}
                advice={guidedAdvice}
                loading={loading}
                onGenerate={generateGuidedAdvice}
                t={t}
              />
            ) : (
              <ActiveBubble
                node={activeBubble}
                answers={answers}
                loading={loading}
                onAnswer={handleAnswer}
                t={t}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
