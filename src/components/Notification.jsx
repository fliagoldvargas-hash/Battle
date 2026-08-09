import { useState, useEffect, useCallback } from 'react'
import { setNotificationHandler } from './notificationService'
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
    <div className="notification-container">
      {notifications.map(n => (
        <div key={n.id} className={`notification show ${n.type}`}>
          <span className="notification-icon">
            {n.type === 'success' ? '✓' : n.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <div className="notification-content">
            <div className="notification-title">{n.title}</div>
            <div className="notification-msg">{n.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
