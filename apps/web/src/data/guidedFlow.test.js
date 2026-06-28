import { describe, expect, it } from 'vitest'
import { getGuidedNode, getGuidedNodeOptions } from './guidedFlow'

describe('guided bubble dynamic options', () => {
  it('does not invent visa options locally when AI/RAG has not returned options', () => {
    const node = getGuidedNode('planning-visa')
    const options = getGuidedNodeOptions(node, { age: 10, locationIntent: 'planning_move' })

    expect(options).toEqual([])
  })

  it('renders only the AI/RAG options supplied by the backend', () => {
    const node = getGuidedNode('planning-visa')
    const options = getGuidedNodeOptions(node, { age: 10, locationIntent: 'planning_move' }, [
      { value: 'family_child', label: 'Family route for a child', next: 'planning-readiness' },
    ])

    expect(options).toEqual([
      { value: 'family_child', label: 'Family route for a child', next: 'planning-readiness' },
    ])
  })
})
