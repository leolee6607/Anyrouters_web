package common

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// SendEmailWithTimeout bounds the complete SMTP conversation, including DATA.
// It is used by leased notification workers; a timed-out goroutine must never
// continue sending after another replica has acquired the lease.
func SendEmailWithTimeout(subject, receiver, content string, timeout time.Duration) error {
	if strings.ContainsAny(receiver, "\r\n;,<>") || timeout <= 0 {
		return fmt.Errorf("invalid recipient or timeout")
	}
	if SMTPServer == "" || SMTPFrom == "" {
		return fmt.Errorf("SMTP is not configured")
	}
	addr := net.JoinHostPort(SMTPServer, fmt.Sprint(SMTPPort))
	deadline := time.Now().Add(timeout)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err = conn.SetDeadline(deadline); err != nil {
		return err
	}
	config := &tls.Config{ServerName: SMTPServer, MinVersion: tls.VersionTLS12}
	implicitTLS := SMTPPort == 465 || SMTPSSLEnabled
	if implicitTLS {
		secure := tls.Client(conn, config)
		if err = secure.Handshake(); err != nil {
			return err
		}
		conn = secure
	}
	client, err := smtp.NewClient(conn, SMTPServer)
	if err != nil {
		return err
	}
	defer client.Close()
	if !implicitTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return fmt.Errorf("SMTP server does not support TLS")
		}
		if err = client.StartTLS(config); err != nil {
			return err
		}
	}
	if err = client.Auth(getSMTPAuth()); err != nil {
		return err
	}
	if err = client.Mail(SMTPFrom); err != nil {
		return err
	}
	// This entry point intentionally accepts one validated mailbox per delivery.
	if strings.ContainsAny(receiver, "\r\n;,") {
		return fmt.Errorf("invalid recipient")
	}
	if err = client.Rcpt(receiver); err != nil {
		return err
	}
	id, err := generateMessageID()
	if err != nil {
		return err
	}
	encodedSubject := base64.StdEncoding.EncodeToString([]byte(subject))
	message := fmt.Sprintf("To: %s\r\nFrom: %s\r\nSubject: =?UTF-8?B?%s?=\r\nDate: %s\r\nMessage-ID: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n", receiver, SMTPFrom, encodedSubject, time.Now().Format(time.RFC1123Z), id, content)
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err = writer.Write([]byte(message)); err != nil {
		return err
	}
	return writer.Close()
}
