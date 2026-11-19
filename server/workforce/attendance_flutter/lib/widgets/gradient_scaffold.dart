import 'package:flutter/material.dart';

/// A Scaffold with a full-screen gradient background — used for
/// splash / blocked / success screens to keep the app feeling colorful.
class GradientScaffold extends StatelessWidget {
  final List<Color> gradientColors;
  final Widget child;
  final PreferredSizeWidget? appBar;

  const GradientScaffold({
    super.key,
    required this.gradientColors,
    required this.child,
    this.appBar,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: appBar,
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: gradientColors,
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(child: child),
      ),
    );
  }
}
