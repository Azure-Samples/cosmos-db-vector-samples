package main

import (
	"errors"
	"testing"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
)

func TestIsNotFoundRequiresTyped404(t *testing.T) {
	if !isNotFound(&azcore.ResponseError{StatusCode: 404}) {
		t.Fatal("expected typed 404 to be recognized")
	}
	if isNotFound(&azcore.ResponseError{StatusCode: 403}) {
		t.Fatal("did not expect typed non-404 to be recognized")
	}
	if isNotFound(errors.New("404 not found")) {
		t.Fatal("did not expect an untyped error message to be recognized")
	}
}
