package cmd

import (
	"os"
	"path/filepath"
	"runtime"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	cfgFile     string
	enableDebug bool

	rootCmd = &cobra.Command{
		Use:   "unfold",
		Short: "An unofficial cli client for fold.money",
	}
)

func init() {
	cobra.OnInitialize(initConfig)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.config/unfold/config.yaml)")
	rootCmd.PersistentFlags().BoolVarP(&enableDebug, "debug", "v", os.Getenv("DEBUG") == "true", "Enable debug mode")
	rootCmd.AddCommand(LoginCmd, RefreshCmd, UserCmd, AvailabilityCmd, TransactionsCmd)
}

func initConfig() {

	// Debug Flag
	if enableDebug {
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	} else {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// Config File
	if cfgFile != "" {
		// An explicit --config path is how multi-account support selects which
		// linked account's token/device_hash set to use. The path may point at a
		// brand-new account with no existing file or parent directory yet.
		dir := filepath.Dir(cfgFile)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			if err := os.MkdirAll(dir, 0700); err != nil {
				log.Error().Err(err).Msg("Failed to create the config directory")
				runtime.Goexit()
			}
		}
		viper.SetConfigFile(cfgFile)
	} else {
		cfgDir, err := os.UserConfigDir()
		cobra.CheckErr(err)
		dir := cfgDir + "/unfold"
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			err := os.MkdirAll(dir, 0700)
			if err != nil {
				log.Error().Err(err).Msg("Failed to create the config directory")
				runtime.Goexit()
			}
		}

		viper.AddConfigPath(dir)
		viper.SetConfigType("yaml")
		viper.SetConfigName("config")
	}

	// A device_hash must exist before the first API request in any command
	// (send-otp, verify-otp, refresh, sync, ...). Setting it as a default here
	// (rather than only in the no --config branch) means every account gets a
	// stable per-account hash: viper's precedence means a value already present
	// in the config file always wins over this default, so once persisted (via
	// main.go's deferred viper.WriteConfig()) it stays stable across process
	// restarts instead of being regenerated each run.
	viper.SetDefault("device_hash", uuid.NewString())
	viper.SafeWriteConfig()

	viper.AutomaticEnv()

	viper.ReadInConfig()
}

// Execute executes the root command.
func Execute() error {
	return rootCmd.Execute()
}
