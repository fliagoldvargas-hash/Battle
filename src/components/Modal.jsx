import { useEffect, useRef } from 'react'
import { Icon } from './BrandMark'
import './Modal.css'

export default function Modal({ isOpen, onClose, title, children, size = 'default' }) {
  const overlayRef = useRef(null)
  const modalRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement
      document.body.style.overflow = 'hidden'
      requestAnimationFrame(() => modalRef.current?.focus())
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      previousFocusRef.current?.focus?.()
    }
  }, [isOpen])

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = modalRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className={`modal modal-${size}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex="-1">
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <Icon name="close" size={19} />
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
