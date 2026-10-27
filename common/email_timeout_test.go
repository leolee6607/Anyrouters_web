package common

import (
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestReminderSMTPHasBoundedHandshake(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	oldServer, oldPort, oldFrom, oldSSL := SMTPServer, SMTPPort, SMTPFrom, SMTPSSLEnabled
	t.Cleanup(func() { SMTPServer, SMTPPort, SMTPFrom, SMTPSSLEnabled = oldServer, oldPort, oldFrom, oldSSL })
	server, port, _ := net.SplitHostPort(listener.Addr().String())
	SMTPServer = server
	SMTPPort, _ = strconv.Atoi(port)
	SMTPFrom = "notify@example.com"
	SMTPSSLEnabled = true
	accepted := make(chan net.Conn, 1)
	go func() {
		connection, err := listener.Accept()
		if err == nil {
			accepted <- connection
		}
	}()
	start := time.Now()
	err = SendEmailWithTimeout("Test", "recipient@example.com", "<p>Test</p>", 100*time.Millisecond)
	require.Error(t, err)
	require.Less(t, time.Since(start), time.Second)
	select {
	case connection := <-accepted:
		connection.Close()
	case <-time.After(time.Second):
		t.Fatal("connection not accepted")
	}
}
