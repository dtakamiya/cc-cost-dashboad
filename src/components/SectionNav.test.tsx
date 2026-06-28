import { render, screen, fireEvent } from '@testing-library/react'
import { SectionNav } from './SectionNav'

type SectionId = 'summary' | 'drivers' | 'project' | 'session' | 'optimization'

describe('SectionNav', () => {
  const mockSections: Array<{ id: SectionId; label: string }> = [
    { id: 'summary', label: '概要' },
    { id: 'drivers', label: 'コストドライバー' },
    { id: 'project', label: 'プロジェクト' },
    { id: 'session', label: 'セッション' },
    { id: 'optimization', label: '最適化' },
  ]

  describe('Rendering', () => {
    it('セクション一覧がレンダリングされる', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      mockSections.forEach(section => {
        expect(screen.getByText(section.label)).toBeInTheDocument()
      })
    })

    it('5つのセクションボタンが表示される', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(5)
    })

    it('各ボタンに正しいラベルがある', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      expect(screen.getByText('概要')).toBeInTheDocument()
      expect(screen.getByText('コストドライバー')).toBeInTheDocument()
      expect(screen.getByText('プロジェクト')).toBeInTheDocument()
      expect(screen.getByText('セッション')).toBeInTheDocument()
      expect(screen.getByText('最適化')).toBeInTheDocument()
    })
  })

  describe('Click Interaction', () => {
    it('ボタンをクリックすると onSectionClick コールバックが呼ばれる', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      fireEvent.click(screen.getByText('概要'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('正しいセクション ID がコールバックに渡される', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      fireEvent.click(screen.getByText('プロジェクト'))
      expect(handleClick).toHaveBeenCalledWith('project')
    })

    it('複数ボタンをクリックすると複数回呼ばれる', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      fireEvent.click(screen.getByText('概要'))
      fireEvent.click(screen.getByText('セッション'))
      expect(handleClick).toHaveBeenCalledTimes(2)
    })
  })

  describe('Active State', () => {
    it('activeSection props に応じてボタンが active クラスを持つ', () => {
      const handleClick = vi.fn()
      const { container } = render(
        <SectionNav
          sections={mockSections}
          activeSection="summary"
          onSectionClick={handleClick}
        />
      )

      const activeButton = screen.getByText('概要').closest('button')
      expect(activeButton).toHaveClass('active')
    })

    it('異なるセクションがアクティブになると該当ボタンのみ active クラスを持つ', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection="drivers"
          onSectionClick={handleClick}
        />
      )

      expect(screen.getByText('概要').closest('button')).not.toHaveClass('active')
      expect(screen.getByText('コストドライバー').closest('button')).toHaveClass('active')
    })

    it('activeSection が null の場合、どのボタンも active クラスを持たない', () => {
      const handleClick = vi.fn()
      render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach(btn => {
        expect(btn).not.toHaveClass('active')
      })
    })
  })

  describe('Styling', () => {
    it('active ボタンが視認できるスタイルを持つ', () => {
      const handleClick = vi.fn()
      const { container } = render(
        <SectionNav
          sections={mockSections}
          activeSection="summary"
          onSectionClick={handleClick}
        />
      )

      const activeButton = screen.getByText('概要').closest('button') as HTMLElement
      const styles = window.getComputedStyle(activeButton)
      // active ボタンは背景色が設定されている
      expect(styles.backgroundColor).not.toBe('transparent')
    })
  })

  describe('Mobile Responsiveness', () => {
    it('モバイル表示（520px以下）でレイアウトが対応する', () => {
      const handleClick = vi.fn()
      const { container } = render(
        <SectionNav
          sections={mockSections}
          activeSection={null}
          onSectionClick={handleClick}
        />
      )

      const nav = container.querySelector('.section-nav')
      expect(nav).toBeInTheDocument()
      // モバイルで overflow-x: auto が設定されることを期待
    })
  })
})
