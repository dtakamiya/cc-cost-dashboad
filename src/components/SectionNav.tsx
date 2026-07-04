export type SectionId = 'summary' | 'drivers' | 'project' | 'session' | 'contextBudget' | 'optimization' | 'toolOutput'

export interface SectionLabel {
  id: SectionId
  label: string
}

interface SectionNavProps {
  sections: SectionLabel[]
  activeSection: SectionId | null
  onSectionClick: (id: SectionId) => void
}

export function SectionNav({ sections, activeSection, onSectionClick }: SectionNavProps) {
  return (
    <nav className="section-nav" role="navigation" aria-label="ダッシュボードセクション">
      {sections.map(section => (
        <button
          key={section.id}
          className={`section-nav-btn ${activeSection === section.id ? 'active' : ''}`}
          onClick={() => onSectionClick(section.id)}
          aria-current={activeSection === section.id ? 'page' : undefined}
        >
          {section.label}
        </button>
      ))}
    </nav>
  )
}
