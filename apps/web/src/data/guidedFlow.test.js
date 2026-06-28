import { describe, expect, it } from 'vitest'
import { getGuidedNode, getGuidedNodeOptions } from './guidedFlow'

describe('guided bubble option safety', () => {
  it('does not show adult study or work visa paths for a 10 year old', () => {
    const node = getGuidedNode('planning-visa')
    const options = getGuidedNodeOptions(node, { age: 10, locationIntent: 'planning_move' })
    const values = options.map((option) => option.value)

    expect(values).not.toContain('student')
    expect(values).not.toContain('skilled_work')
    expect(values).not.toContain('blue_card')
    expect(values).not.toContain('opportunity_card')
    expect(values).toContain('family')
  })
})
