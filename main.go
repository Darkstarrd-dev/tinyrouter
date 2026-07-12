package main

//go:generate rsrc -ico web/static/favicon.ico -manifest rsrc.manifest -o rsrc.syso

import (
	"flag"
	"log"

	"github.com/tinyrouter/tinyrouter/internal/app"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	a, err := app.New(*configPath)
	if err != nil {
		log.Fatalf("%v", err)
	}
	if err := a.Run(runHostLoop); err != nil {
		log.Fatalf("%v", err)
	}
}
