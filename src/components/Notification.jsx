import { useState, useEffect, useCallback } from 'react'
import { setNotificationHandler } from './notificationService'
import { Icon } from './BrandMark'
import './Notification.css'

export default function NotificationContainer() {
  const [notifications, setNotifications] = useState([])

  const addNotification = useCallback((notif) => {
    const id = Date.now() + Math.random()
    setNotifications(prev => [...prev, { ...notif, id }])
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 4000)
  }, [])

  useEffect(() => {
    setNotificationHandler(addNotification)
    return () => setNotificationHandler(null)
  }, [addNotification])

  return (
    <div className="notification-container" aria-live="polite" aria-atomic="false">
      {notifications.map(n => (
        <div key={n.id} className={`notification show ${n.type}`}>
          <span className="notification-icon"><Icon name={n.type === 'success' ? 'check' : n.type === 'error' ? 'close' : 'protocol'} size={17} /></span>
          <div className="notification-content">
            <div className="notification-title">{n.title}</div>
            <div className="notification-msg">{n.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
