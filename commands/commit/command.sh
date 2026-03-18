#!/usr/bin/env bash

echo -e "\e[31mWHOA THERE! Slow down!\e[0m"
echo -e "\e[33mCommitting bulk changes blindly is a terrible idea!\e[0m"
echo ""
echo -e "\e[31mWhy?\e[0m"
echo -e "  \e[90m• You won't know what you're actually committing\e[0m"
echo -e "  \e[90m• Hard to revert when things break\e[0m"
echo -e "  \e[90m• Your teammates will judge you\e[0m"
echo -e "  \e[90m• Debugging becomes a nightmare\e[0m"
echo ""
echo -e "\e[32mDo this instead:\e[0m"
echo -e "  \e[90m• Review staged changes: \e[36mgit diff --cached\e[0m"
echo -e "  \e[90m• Commit logically:      \e[36m$ENTITY commit staged\e[0m"
echo ""

exit 1
